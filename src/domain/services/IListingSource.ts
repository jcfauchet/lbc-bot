import { ScrapedListing } from '@/infrastructure/scraping/types'

export interface IListingSource {
  search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]>
}

/**
 * The source was refused by DataDome rather than failing for a reason a retry
 * or another transport could fix. Callers use this to skip the browser
 * fallback: it walks into the same wall, and pays a chromium launch and a
 * screenshot upload to find that out.
 *
 * The message keeps the word "Datadome" because DataDomeBypass matches on it to
 * decide when to rotate the user agent.
 */
export class DataDomeBlockedError extends Error {
  constructor(message = 'Access blocked by Datadome. The API request was rejected.') {
    super(message)
    this.name = 'DataDomeBlockedError'
  }
}
