import { ScrapedListing } from '@/infrastructure/scraping/types'

export interface IListingSource {
  scrape(searchUrl: string, searchName?: string): Promise<ScrapedListing[]>
}

