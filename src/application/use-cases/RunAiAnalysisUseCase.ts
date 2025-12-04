import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'
import { ITaxonomyRepository } from '@/domain/repositories/ITaxonomyRepository'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { IReferenceScraper } from '@/infrastructure/scraping/reference/IReferenceScraper'
import { GoogleImageScraper } from '@/infrastructure/scraping/reference/Google/GoogleImageScraper'
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
    private referenceScrapers: Map<string, IReferenceScraper>,
    private taxonomyRepository: ITaxonomyRepository,
    private googleImageScraper?: GoogleImageScraper
  ) {}

  async execute(
    batchSize: number = 10
  ): Promise<{ analyzed: number; errors: number }> {
    const listingsWithoutAnalysis =
      await this.listingRepository.findWithoutAiAnalysis()

    const batch = listingsWithoutAnalysis.slice(0, batchSize)

    const categories = await this.taxonomyRepository.getCategories()
    console.log(`📋 Categories loaded from DB: ${categories.length} categories`)
    if (categories.length > 0) {
      console.log(`   Categories: ${categories.join(', ')}`)
    } else {
      console.warn(`⚠️  No categories found in database!`)
    }

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
          undefined,
          categories
        )

        console.log(`  → Estimated price: ${preEstimation.estimatedMinPrice.getEuros()}€ - ${preEstimation.estimatedMaxPrice.getEuros()}€`)
        console.log(`  → isPromising: ${preEstimation.isPromising}, hasDesigner: ${preEstimation.hasDesigner}, shouldProceed: ${preEstimation.shouldProceed}`)
        console.log(`  → Confidence: ${((preEstimation.confidence || 0) * 100).toFixed(1)}%`)

        // Vérifier si le prix estimé minimum est intéressant (au moins MIN_MARGIN_IN_EUR)
        const estimatedMinPriceEuros = preEstimation.estimatedMinPrice.getEuros()
        // Seuil réduit pour être plus permissif (50% de MIN_MARGIN_IN_EUR au lieu de 100%)
        const isPriceInteresting = estimatedMinPriceEuros >= (env.MIN_MARGIN_IN_EUR * 0.5)
        
        if (!preEstimation.shouldProceed && !isPriceInteresting) {
          console.log(`  ❌ Skipping listing ${listing.title} - shouldProceed: false and price not interesting (${estimatedMinPriceEuros}€)`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        // Continuer même si isPromising est false si le prix estimé est intéressant
        if (!preEstimation.isPromising && !isPriceInteresting) {
          console.log(`Skipping listing ${listing.title} - Pre-estimation not promising and price not interesting (${estimatedMinPriceEuros}€ - ${preEstimation.estimatedMaxPrice.getEuros()}€)`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        // Continuer même sans designer si le prix est intéressant ou si on a des search terms
        if (!preEstimation.hasDesigner && preEstimation.searchTerms.length === 0 && !isPriceInteresting) {
          console.log(`Skipping listing ${listing.title} - No designer, no search terms, and price not interesting (${estimatedMinPriceEuros}€)`)
          listing.markAsIgnored()
          await this.listingRepository.update(listing)
          continue
        }

        console.log(`Found ${preEstimation.searchTerms.length} search terms, scraping partner sites...`)
        const allScrapedReferences: any[] = []

        if (this.googleImageScraper && imageUrls.length > 0) {
          try {
            console.log(`Scraping Google Image with image: ${imageUrls[0]}`)
            const googleResults = await this.googleImageScraper.scrape(imageUrls[0])
            console.log(`Found ${googleResults.length} results from Google Image`)
            allScrapedReferences.push(...googleResults)
          } catch (e) {
            console.error(`Failed to scrape Google Image:`, e)
          }
        }

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

        // Réduire le seuil de confiance de 0.8 à 0.6 pour être plus permissif
        if (!estimation.confidence || estimation.confidence < 0.6) {
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
          searchTerms: preEstimation.searchTerms,
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

