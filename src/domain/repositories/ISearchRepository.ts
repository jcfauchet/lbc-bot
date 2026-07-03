import { Search } from '../entities/Search'

export interface ISearchRepository {
  save(search: Search): Promise<Search>
  findById(id: string): Promise<Search | null>
  /**
   * Active searches, most-starved first (never-scraped, then oldest
   * lastScrapedAt). The scrape run often dies midway (anti-bot block,
   * serverless timeout), so a fixed order permanently starves the tail.
   */
  findActive(): Promise<Search[]>
  findAll(): Promise<Search[]>
  update(search: Search): Promise<Search>
  delete(id: string): Promise<void>
  /** Stamps lastScrapedAt so the rotation moves this search to the back. */
  markScraped(id: string): Promise<void>
}

