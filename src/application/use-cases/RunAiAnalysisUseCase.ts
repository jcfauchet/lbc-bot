import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { ReferenceProductService } from '@/infrastructure/scraping/ReferenceProductService'
import { AiCategorizationService } from '@/infrastructure/ai/AiCategorizationService'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'


export class RunAiAnalysisUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private imageRepository: IListingImageRepository,
    private priceEstimationService: IPriceEstimationService,
    private imageDownloadService: ImageDownloadService,
    private storageService: IStorageService,
    private referenceProductService: ReferenceProductService,
    private categorizationService: AiCategorizationService
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

        await this.imageDownloadService.downloadListingImages(listing.id)

        const images = await this.imageRepository.findByListingId(listing.id)
        const imageUrls = images
          .map((img) => img.pathLocal || img.urlRemote)
          .filter(Boolean)

        if (imageUrls.length === 0) {
          console.warn(`No images available for listing ${listing.id}`)
          continue
        }

        // 1. Categorize the listing to find better references
        console.log(`Categorizing listing: ${listing.title}`)
        const categorization = await this.categorizationService.categorize(listing.title)
        
        // 2. Find similar reference products using categorization
        console.log(`Fetching reference products for: ${listing.title}`)
        const referenceProducts = await this.referenceProductService.findSimilarProducts(
          listing.title,
          categorization ? {
            category: categorization.category,
            period: categorization.period,
            style: categorization.style,
            material: categorization.material,
            designer: categorization.designer
          } : undefined,
          10
        )
        console.log(`Found ${referenceProducts.length} reference products`)

        const estimation = await this.priceEstimationService.estimatePrice(
          imageUrls,
          listing.title,
          undefined,
          referenceProducts
        )

        if ('cleanupReferenceImages' in this.priceEstimationService && typeof this.priceEstimationService.cleanupReferenceImages === 'function') {
          await (this.priceEstimationService as any).cleanupReferenceImages()
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
        })

        await this.aiAnalysisRepository.save(analysis)

        listing.markAsAnalyzed()
        await this.listingRepository.update(listing)

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
        console.log(
          `Analysis completed for ${listing.title}`
        )

        await this.delay(1000)
      } catch (error) {
        console.error(`Error analyzing listing ${listing.id}:`, error)
        errors++
      }
    }

    return { analyzed, errors }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

