import { ListingLabel } from '../entities/ListingLabel'

export interface IListingLabelRepository {
  save(label: ListingLabel): Promise<ListingLabel>
  findById(id: string): Promise<ListingLabel | null>
  findByListingId(listingId: string): Promise<ListingLabel[]>
  findByLabel(label: string): Promise<ListingLabel[]>
  delete(id: string): Promise<void>
}

