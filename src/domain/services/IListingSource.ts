import { ScrapedListing } from '@/infrastructure/scraping/types'

export interface IListingSource {
  search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]>
}

