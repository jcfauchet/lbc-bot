import { v2 as cloudinary } from 'cloudinary'
import { IStorageService } from './IStorageService'
import crypto from 'crypto'

export class CloudinaryStorageService implements IStorageService {
  private readonly MAX_PUBLIC_ID_LENGTH = 255
  private readonly MAX_LISTING_ID_LENGTH = 100

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials are missing. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.')
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    })
  }

  private sanitizePublicId(id: string): string {
    let sanitized = id
      .replace(/[^a-zA-Z0-9_\-/]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')

    if (sanitized.length > this.MAX_LISTING_ID_LENGTH) {
      const hash = crypto.createHash('sha256').update(id).digest('hex').substring(0, 32)
      const prefix = sanitized.substring(0, this.MAX_LISTING_ID_LENGTH - 33)
      sanitized = `${prefix}_${hash}`
    }

    return sanitized
  }

  async saveImage(
    url: string,
    listingId: string,
    index: number
  ): Promise<string> {
    try {
      let sanitizedListingId = this.sanitizePublicId(listingId)
      let publicIdSuffix = `${sanitizedListingId}_${index}`
      let fullPublicId = `listings/${sanitizedListingId}/${publicIdSuffix}`
      
      if (fullPublicId.length > this.MAX_PUBLIC_ID_LENGTH) {
        const hash = crypto.createHash('sha256').update(listingId).digest('hex').substring(0, 32)
        const indexStr = String(index)
        const maxIdLength = this.MAX_PUBLIC_ID_LENGTH - `listings//_${indexStr}`.length - hash.length - 1
        const truncatedId = sanitizedListingId.substring(0, Math.max(0, maxIdLength))
        sanitizedListingId = `${truncatedId}_${hash}`
        publicIdSuffix = `${sanitizedListingId}_${index}`
        fullPublicId = `listings/${sanitizedListingId}/${publicIdSuffix}`
      }
      
      const existing = await cloudinary.api.resource(fullPublicId).catch(() => null)
      if (existing) {
        return existing.secure_url
      }

      const result = await cloudinary.uploader.upload(url, {
        folder: `listings/${sanitizedListingId}`,
        public_id: publicIdSuffix,
        overwrite: false,
        resource_type: 'image',
      })

      return result.secure_url
    } catch (error) {
      console.error(`Error uploading image to Cloudinary from ${url}:`, error)
      throw error
    }
  }

  getImagePath(listingId: string, filename: string): string {
    return `listings/${listingId}/${filename}`
  }

  async deleteImage(relativePath: string): Promise<void> {
    try {
      let publicId = relativePath
      
      if (relativePath.startsWith('http')) {
        const url = new URL(relativePath)
        const pathParts = url.pathname.split('/')
        const uploadIndex = pathParts.indexOf('upload')
        if (uploadIndex !== -1 && uploadIndex < pathParts.length - 1) {
          const afterUpload = pathParts.slice(uploadIndex + 1)
          const versionIndex = afterUpload.findIndex(p => p.startsWith('v'))
          if (versionIndex !== -1) {
            publicId = afterUpload.slice(versionIndex + 1).join('/')
          } else {
            publicId = afterUpload.join('/')
          }
          publicId = publicId.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')
        } else {
          return
        }
      } else {
        publicId = relativePath.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')
      }
      
      await cloudinary.uploader.destroy(publicId)
    } catch (error) {
      console.error(`Error deleting image ${relativePath} from Cloudinary:`, error)
    }
  }
}

