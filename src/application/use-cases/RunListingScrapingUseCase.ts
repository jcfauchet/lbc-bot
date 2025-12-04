import { ISearchRepository } from '@/domain/repositories/ISearchRepository'
import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IListingSource } from '@/domain/services/IListingSource'
import { Listing } from '@/domain/entities/Listing'
import { ListingImage } from '@/domain/entities/ListingImage'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Search } from '@/domain/entities/Search'
import { ScrapedListing } from '@/infrastructure/scraping/types'

export class RunListingScrapingUseCase {
  constructor(
    private searchRepository: ISearchRepository,
    private listingRepository: IListingRepository,
    private imageRepository: IListingImageRepository,
    private listingSourceApi: IListingSource,
    private listingSourceScraper: IListingSource
  ) {}

  private async getListings(search: Search): Promise<ScrapedListing[]> {
    try {
      const scrapedListingsByApi = await this.listingSourceApi.search(search.url, search.name)
      return scrapedListingsByApi
    } catch (error) {
      console.error(`Error getting listings for search: ${search.name}`, error)

      console.log('--> Trying to scrape with scraper...')
      const scrapedListingsByScraper = await this.listingSourceScraper.search(search.url, search.name)
      return scrapedListingsByScraper
    }
  }

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
        const scrapedListings = await this.getListings(search)

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

        const randomDelay = Math.floor(Math.random() * 8000) + 5000
        console.log(`Waiting ${randomDelay}ms before next search to avoid DataDome blocking...`)
        await this.delay(randomDelay)
      } catch (error) {
        console.error(`Error scraping ${search.name}:`, error)
        const randomDelay = Math.floor(Math.random() * 10000) + 8000
        console.log(`⚠️ Error occurred, waiting ${randomDelay}ms before next search...`)
        await this.delay(randomDelay)
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

