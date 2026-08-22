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

        // The same ad can be returned twice on a page; a batch insert would
        // trip the lbcId unique constraint and lose the whole page.
        const uniqueScraped = [
          ...new Map(scrapedListings.map((s) => [s.lbcId, s])).values(),
        ]

        // One lookup for the page instead of one per ad. This loop used to be
        // the bulk of the cron's wall time: ~35 sequential round trips per
        // search, and the run was being killed before its last search.
        const knownLbcIds = await this.listingRepository.findExistingLbcIds(
          uniqueScraped.map((s) => s.lbcId)
        )
        const fresh = uniqueScraped.filter((s) => !knownLbcIds.has(s.lbcId))
        updatedListings += uniqueScraped.length - fresh.length

        const saved = await this.listingRepository.saveMany(
          fresh.map((scraped) =>
            Listing.create({
              lbcId: scraped.lbcId,
              searchId: search.id,
              url: scraped.url,
              title: scraped.title,
              description: scraped.description,
              price: Money.fromCents(scraped.priceCents),
              city: scraped.city,
              region: scraped.region,
              publishedAt: scraped.publishedAt,
              status: ListingStatus.NEW,
            })
          )
        )

        const imageUrlsByLbcId = new Map(
          fresh.map((scraped) => [scraped.lbcId, scraped.imageUrls])
        )
        await this.imageRepository.saveMany(
          saved.flatMap((listing) =>
            (imageUrlsByLbcId.get(listing.lbcId) ?? []).map((urlRemote) =>
              ListingImage.create({ listingId: listing.id, urlRemote })
            )
          )
        )

        newListings += saved.length
        console.log(
          `${search.name}: ${saved.length} new, ${uniqueScraped.length - fresh.length} already known`
        )

        const randomDelay = Math.floor(Math.random() * 8000) + 5000
        console.log(`Waiting ${randomDelay}ms before next search to avoid DataDome blocking...`)
        await this.delay(randomDelay)
      } catch (error) {
        console.error(`Error scraping ${search.name}:`, error)
        const randomDelay = Math.floor(Math.random() * 10000) + 8000
        console.log(`⚠️ Error occurred, waiting ${randomDelay}ms before next search...`)
        await this.delay(randomDelay)
      } finally {
        await this.searchRepository.markScraped(search.id)
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

