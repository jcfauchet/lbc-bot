export interface IStorageService {
  saveImage(url: string, listingId: string, index: number): Promise<string>
  getImagePath(listingId: string, filename: string): string
  deleteImage(path: string): Promise<void>
}

