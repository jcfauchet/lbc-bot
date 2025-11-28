import { ListingImage } from '../entities/ListingImage'

export interface IListingImageRepository {
  save(image: ListingImage): Promise<ListingImage>
  findById(id: string): Promise<ListingImage | null>
  findByListingId(listingId: string): Promise<ListingImage[]>
  findNotDownloaded(): Promise<ListingImage[]>
  update(image: ListingImage): Promise<ListingImage>
  delete(id: string): Promise<void>
}

