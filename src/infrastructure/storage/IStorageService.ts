export interface IStorageService {
  saveImage(url: string, listingId: string, index: number): Promise<string>
  getImagePath(listingId: string, filename: string): string
  deleteImage(path: string): Promise<void>
  saveReferenceImage(bytes: Buffer, mimeType: string, referenceKey: string, index: number): Promise<string>
}

