export interface RawListing {
  sourceName: string;
  sourceListingId: string;
  url: string;
  title: string;
  description?: string;
  brand?: string;
  model?: string;
  category?: string;
  subCategory?: string;
  designer?: string;
  period?: string;
  material?: string;
  style?: string;
  reference?: string;
  condition?: string;
  price?: number;
  currency?: string;
  imageUrls?: string[];
  scrapedAt: Date;
}

export interface SiteScraper {
  sourceName: string;
  scrape(): Promise<RawListing[]>;
}
