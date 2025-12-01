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
  deleteOlderThan(days: number): Promise<number>
}

