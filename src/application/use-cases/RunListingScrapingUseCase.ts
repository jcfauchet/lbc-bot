import { ISearchRepository } from '@/domain/repositories/ISearchRepository'
import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IListingSource } from '@/domain/services/IListingSource'
import { Listing } from '@/domain/entities/Listing'
import { ListingImage } from '@/domain/entities/ListingImage'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export class RunListingScrapingUseCase {
  constructor(
    private searchRepository: ISearchRepository,
    private listingRepository: IListingRepository,
    private imageRepository: IListingImageRepository,
    private listingSource: IListingSource
  ) {}

  async execute(): Promise<{
    totalSearches: number
    newListings: number
    updatedListings: number
  }> {
    const searches = await this.searchRepository.findActive()

    let newListings = 0
    let updatedListings = 0

    for (const search of searches) {
      try {
        console.log(`Scraping search: ${search.name}`)
        const scrapedListings = await this.listingSource.scrape(search.url, search.name)

        for (const scraped of scrapedListings) {
          const existing = await this.listingRepository.findByLbcId(
            scraped.lbcId
          )

          if (existing) {
            updatedListings++
            continue
          }

          const listing = Listing.create({
            lbcId: scraped.lbcId,
            searchId: search.id,
            url: scraped.url,
            title: scraped.title,
            price: Money.fromCents(scraped.priceCents),
            city: scraped.city,
            region: scraped.region,
            publishedAt: scraped.publishedAt,
            status: ListingStatus.NEW,
          })

          const savedListing = await this.listingRepository.save(listing)

          for (const imageUrl of scraped.imageUrls) {
            const image = ListingImage.create({
              listingId: savedListing.id,
              urlRemote: imageUrl,
            })
            await this.imageRepository.save(image)
          }

          newListings++
          console.log(`New listing saved: ${savedListing.title}`)
        }

        await this.delay(2000)
      } catch (error) {
        console.error(`Error scraping ${search.name}:`, error)
      }
    }

    return {
      totalSearches: searches.length,
      newListings,
      updatedListings,
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

