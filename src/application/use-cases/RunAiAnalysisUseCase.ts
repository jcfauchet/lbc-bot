import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'
import { ITextFilterService } from '@/domain/services/ITextFilterService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { env } from '@/infrastructure/config/env'

export class RunAiAnalysisUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private imageRepository: IListingImageRepository,
    private priceEstimationService: IPriceEstimationService,
    private imageDownloadService: ImageDownloadService,
    private storageService: IStorageService,
    private textFilterService: ITextFilterService
  ) {}

  async execute(
    batchSize: number = 10
  ): Promise<{ analyzed: number; errors: number }> {
    const listingsWithoutAnalysis =
      await this.listingRepository.findWithoutAiAnalysis()

    const batch = listingsWithoutAnalysis.slice(0, batchSize)

    let analyzed = 0
    let errors = 0

    for (const listing of batch) {
      try {
        console.log(`Analyzing listing: ${listing.title}`)
        
        const filterResult = this.textFilterService.shouldExclude(listing.title)
        if (filterResult.exclude) {
          console.log(`  → Exclu par filtre textuel: ${filterResult.reason}`)
          listing.markAsIgnored()
          listing.setIgnoreReason(filterResult.reason || 'Filtre textuel')
          await this.listingRepository.update(listing)
          continue
        }
        
        listing.markAsAnalyzing()
        await this.listingRepository.update(listing)

        await this.imageDownloadService.downloadListingImages(listing.id)

        const images = await this.imageRepository.findByListingId(listing.id)
        const imageUrls = images
          .map((img) => img.pathLocal || img.urlRemote)
          .filter(Boolean)

        if (imageUrls.length === 0) {
          console.warn(`No images available for listing ${listing.id}`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        const estimation = await this.priceEstimationService.estimatePrice(
          imageUrls,
          listing.title,
          undefined,
          []
        )

        console.log(`  → Estimated price: ${estimation.estimatedMinPrice.getEuros()}€ - ${estimation.estimatedMaxPrice.getEuros()}€`)
        console.log(`  → Confidence: ${((estimation.confidence || 0) * 100).toFixed(1)}%`)

        const estimatedMinPriceEuros = estimation.estimatedMinPrice.getEuros()
        const isPriceInteresting = estimatedMinPriceEuros >= (env.MIN_MARGIN_IN_EUR * 0.5)

        if (!estimation.confidence || estimation.confidence < 0.6) {
          console.log(`Estimation confidence too low (${estimation.confidence}), skipping ${listing.title}`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        if (!isPriceInteresting) {
          console.log(`Price not interesting (${estimatedMinPriceEuros}€), skipping ${listing.title}`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        const margin = estimation.estimatedMinPrice.minus(listing.price)

        const analysis = AiAnalysis.create({
          listingId: listing.id,
          estimatedMinPrice: estimation.estimatedMinPrice,
          estimatedMaxPrice: estimation.estimatedMaxPrice,
          margin: margin,
          description: estimation.description,
          confidence: estimation.confidence,
          provider: this.priceEstimationService.providerName,
          bestMatchSource: estimation.bestMatchSource,
          searchTerms: [],
        })

        await this.aiAnalysisRepository.save(analysis)

        if (listing.status !== ListingStatus.ANALYZED) {
          listing.markAsAnalyzed()
          await this.listingRepository.update(listing)
        }

        for (const image of images) {
          if (image.pathLocal && image.pathLocal.startsWith('http')) {
            try {
              await this.storageService.deleteImage(image.pathLocal)
              image.setLocalPath(undefined)
              await this.imageRepository.update(image)
            } catch (error) {
              console.error(`Failed to delete image ${image.id}:`, error)
            }
          }
        }

        analyzed++
        console.log(`Analysis completed for ${listing.title}`)

        await this.delay(1000)
      } catch (error) {
        console.error(`Error analyzing listing ${listing.id}:`, error)
        if (listing.status === ListingStatus.ANALYZING) {
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
        }
        errors++
      }
    }

    return { analyzed, errors }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

