import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { IReferenceScraper } from '@/infrastructure/scraping/reference/IReferenceScraper'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export class RunAiAnalysisUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private imageRepository: IListingImageRepository,
    private priceEstimationService: IPriceEstimationService,
    private imageDownloadService: ImageDownloadService,
    private storageService: IStorageService,
    private referenceScrapers: Map<string, IReferenceScraper>
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

        console.log(`Pre-estimating listing: ${listing.title}`)
        const preEstimation = await this.priceEstimationService.preEstimate(
          imageUrls,
          listing.title,
          undefined
        )

        if (!preEstimation.shouldProceed) {
          console.log(`Skipping listing ${listing.title} - shouldProceed: false (isPromising: ${preEstimation.isPromising}, hasDesigner: ${preEstimation.hasDesigner})`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        if (!preEstimation.isPromising) {
          console.log(`Skipping listing ${listing.title} - Pre-estimation not promising (${preEstimation.estimatedMinPrice.getEuros()}€ - ${preEstimation.estimatedMaxPrice.getEuros()}€)`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        if (!preEstimation.hasDesigner || preEstimation.searchTerms.length === 0) {
          console.log(`Skipping listing ${listing.title} - No designer identified or no search terms generated`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        console.log(`Found ${preEstimation.searchTerms.length} search terms, scraping partner sites...`)
        const allScrapedReferences: any[] = []

        for (const searchTerm of preEstimation.searchTerms) {
          for (const [scraperName, scraper] of this.referenceScrapers.entries()) {
            try {
              console.log(`Scraping ${scraperName} with query: ${searchTerm.query}`)
              const results = await scraper.scrape(searchTerm.query)
              console.log(`Found ${results.length} results from ${scraperName}`)
              allScrapedReferences.push(...results)
            } catch (e) {
              console.error(`Failed to scrape ${scraperName}:`, e)
            }
          }
        }

        if (allScrapedReferences.length === 0) {
          console.log(`No reference products found, skipping final estimation for ${listing.title}`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        console.log(`Found ${allScrapedReferences.length} reference products, running final estimation...`)
        const estimation = await this.priceEstimationService.estimatePrice(
          imageUrls,
          listing.title,
          undefined,
          allScrapedReferences
        )

        if (!estimation.confidence || estimation.confidence < 0.8) {
          console.log(`Estimation confidence too low (${estimation.confidence}), skipping ${listing.title}`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

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
          bestMatchSource: estimation.bestMatchSource,
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
        console.log(
          `Analysis completed for ${listing.title}`
        )

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

