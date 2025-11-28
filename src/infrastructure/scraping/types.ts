export interface ScrapedListing {
  lbcId: string
  url: string
  title: string
  priceCents: number
  city?: string
  region?: string
  publishedAt?: Date
  imageUrls: string[]
}

export interface IScraper {
  scrape(searchUrl: string): Promise<ScrapedListing[]>
}

