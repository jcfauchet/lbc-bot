import { IStorageService } from './IStorageService'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { ListingImage } from '@/domain/entities/ListingImage'

export class ImageDownloadService {
  constructor(
    private storage: IStorageService,
    private imageRepository: IListingImageRepository
  ) {}

  async downloadListingImages(listingId: string): Promise<void> {
    const images = await this.imageRepository.findByListingId(listingId)

    for (let i = 0; i < images.length; i++) {
      const image = images[i]

      if (image.isDownloaded()) {
        continue
      }

      try {
        const localPath = await this.storage.saveImage(
          image.urlRemote,
          listingId,
          i
        )

        image.setLocalPath(localPath)
        await this.imageRepository.update(image)

        await this.delay(500)
      } catch (error) {
        console.error(`Failed to download image ${image.id}:`, error)
      }
    }
  }

  async downloadPendingImages(batchSize: number = 10): Promise<void> {
    const images = await this.imageRepository.findNotDownloaded()
    const batch = images.slice(0, batchSize)

    for (let i = 0; i < batch.length; i++) {
      const image = batch[i]

      try {
        const localPath = await this.storage.saveImage(
          image.urlRemote,
          image.listingId,
          i
        )

        image.setLocalPath(localPath)
        await this.imageRepository.update(image)

        await this.delay(500)
      } catch (error) {
        console.error(`Failed to download image ${image.id}:`, error)
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

