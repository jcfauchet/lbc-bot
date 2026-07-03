import { Listing } from '../entities/Listing'
import { ListingStatus } from '../value-objects/ListingStatus'

export interface IListingRepository {
  save(listing: Listing): Promise<Listing>
  findById(id: string): Promise<Listing | null>
  findByLbcId(lbcId: string): Promise<Listing | null>
  findBySearchId(searchId: string): Promise<Listing[]>
  findByStatus(status: ListingStatus): Promise<Listing[]>
  findWithoutAiAnalysis(): Promise<Listing[]>
  findAll(): Promise<Listing[]>
  update(listing: Listing): Promise<Listing>
  delete(id: string): Promise<void>
  deleteIgnoredOlderThan(days: number): Promise<number>
  /**
   * Bulk-ignores TRIAGED listings older than `days`. Vintage deals are gone
   * within days, so a stale triaged listing would only burn a paid comp credit
   * on a piece nobody can buy anymore. Returns the number of expired listings.
   */
  ignoreTriagedOlderThan(days: number, reason: string): Promise<number>
}

