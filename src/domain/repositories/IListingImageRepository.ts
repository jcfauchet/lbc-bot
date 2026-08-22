import { ListingImage } from '../entities/ListingImage'

export interface IListingImageRepository {
  save(image: ListingImage): Promise<ListingImage>
  /** Inserts a batch in one round trip. Ids are not read back. */
  saveMany(images: ListingImage[]): Promise<void>
  findById(id: string): Promise<ListingImage | null>
  findByListingId(listingId: string): Promise<ListingImage[]>
  findNotDownloaded(): Promise<ListingImage[]>
  update(image: ListingImage): Promise<ListingImage>
  delete(id: string): Promise<void>
}

