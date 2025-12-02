import { v2 as cloudinary } from 'cloudinary'
import { IStorageService } from './IStorageService'

export class CloudinaryStorageService implements IStorageService {
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
    return id
      .replace(/[^a-zA-Z0-9_\-/]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async saveImage(
    url: string,
    listingId: string,
    index: number
  ): Promise<string> {
    try {
      const sanitizedListingId = this.sanitizePublicId(listingId)
      const publicId = `listings/${sanitizedListingId}/${sanitizedListingId}_${index}`
      
      const existing = await cloudinary.api.resource(publicId).catch(() => null)
      if (existing) {
        return existing.secure_url
      }

      const result = await cloudinary.uploader.upload(url, {
        folder: `listings/${sanitizedListingId}`,
        public_id: `${sanitizedListingId}_${index}`,
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

