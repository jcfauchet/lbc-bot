import { IStorageService } from './IStorageService'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

export class LocalStorageService implements IStorageService {
  private basePath: string

  constructor(basePath: string = './public/images/listings') {
    this.basePath = basePath
  }

  async saveImage(
    url: string,
    listingId: string,
    index: number
  ): Promise<string> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      const extension = this.getExtensionFromUrl(url)
      const filename = `${listingId}_${index}${extension}`
      const dirPath = path.join(this.basePath, listingId)

      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true })
      }

      const filePath = path.join(dirPath, filename)
      await writeFile(filePath, Buffer.from(buffer))

      return `/images/listings/${listingId}/${filename}`
    } catch (error) {
      console.error(`Error saving image from ${url}:`, error)
      throw error
    }
  }

  getImagePath(listingId: string, filename: string): string {
    return `/images/listings/${listingId}/${filename}`
  }

  async deleteImage(relativePath: string): Promise<void> {
    try {
      const absolutePath = path.join(process.cwd(), 'public', relativePath)
      await unlink(absolutePath)
    } catch (error) {
      console.error(`Error deleting image ${relativePath}:`, error)
    }
  }

  private getExtensionFromUrl(url: string): string {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)
    return match ? `.${match[1]}` : '.jpg'
  }
}

