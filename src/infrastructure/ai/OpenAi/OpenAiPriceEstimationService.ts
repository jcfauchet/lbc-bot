import OpenAI from 'openai'
import {
  PriceEstimationResult,
  ReferenceProduct,
  SearchAnalysisResult,
  PreEstimationResult,
  FinalEstimationResult,
} from '@/domain/services/IPriceEstimationService'
import { BasePriceEstimationService } from '../BasePriceEstimationService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'

export class OpenAiPriceEstimationService extends BasePriceEstimationService {
  public readonly providerName = 'openai'
  private client: OpenAI
  private storageService?: IStorageService
  private uploadedReferenceImageUrls: string[] = []

  constructor(apiKey: string, storageService?: IStorageService) {
    super()
    this.client = new OpenAI({ apiKey })
    this.storageService = storageService
  }

  async preEstimate(
    images: string[],
    title: string,
    description?: string,
    categories?: string[]
  ): Promise<PreEstimationResult> {
    try {
      const imageContents = await this.prepareImagesForPreEstimate(images)
      const prompt = this.buildPreEstimationPrompt(title, description, categories)

      const response = await this.client.chat.completions.create({
        model: 'gpt-5.1',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: this.getSystemInstruction()
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContents.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          },
        ],
        // max_tokens: 1000,
        temperature: 0.2,
      })

      const content = response.choices[0]?.message?.content || ''
      if (!content) {
        throw new Error('OpenAI returned empty response')
      }
      return this.parsePreEstimationResponse(content)
    } catch (error) {
      console.error('OpenAI pre-estimation error:', error)
      throw new Error(`Failed to pre-estimate with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async analyzeForSearch(
    images: string[],
    title: string,
    description?: string
  ): Promise<SearchAnalysisResult> {
    try {
      const imageContents = await this.prepareImages(images)
      const prompt = this.buildSearchPrompt(title, description)

      const response = await this.client.chat.completions.create({
        model: 'gpt-5.1',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: this.getSystemInstruction()
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContents.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          },
        ],
        // max_tokens: 1000,
        temperature: 0.2,
      })

      const content = response.choices[0]?.message?.content || ''
      if (!content) {
        throw new Error('OpenAI returned empty response')
      }
      return this.parseSearchResponse(content)
    } catch (error) {
      console.error('OpenAI search analysis error:', error)
      throw new Error(`Failed to analyze for search with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts: ReferenceProduct[] = []
  ): Promise<FinalEstimationResult> {
    try {
      const imageContents = await this.prepareImages(images)
      const referenceImagesMap = await this.prepareReferenceImages(referenceProducts)

      const userContent: any[] = [
        { type: 'text', text: this.buildUserContext(title, description) },
        ...imageContents.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
      ]

      if (referenceProducts.length > 0) {
        userContent.push({
          type: 'text',
          text: '\n\nPRODUITS DE RÉFÉRENCE SIMILAIRES :\nVoici des produits similaires trouvés sur des sites spécialisés. Je vais te présenter chaque produit avec ses détails et son image correspondante (si disponible).',
        })

        for (let i = 0; i < Math.min(referenceProducts.length, 5); i++) {
          const ref = referenceProducts[i]
          userContent.push({
            type: 'text',
            text: this.formatReferenceProduct(ref, i),
          })

          const refImageUrl = referenceImagesMap.get(i)
          if (refImageUrl) {
            userContent.push({
              type: 'image_url',
              image_url: { url: refImageUrl },
            })
          }
        }
      }

      userContent.push({ type: 'text', text: this.getAnalysisInstructions() })

      const response = await this.client.chat.completions.create({
        model: 'gpt-5.1',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: this.getSystemInstruction(),
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        // max_tokens: 1000,
        temperature: 0.2,
      })

      const content = response.choices[0]?.message?.content || ''
      if (!content) {
        console.error('OpenAI returned empty content')
        throw new Error('OpenAI returned empty response')
      }
      return this.parseFinalEstimationResponse(content, referenceProducts)
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid response format')) {
        console.error('OpenAI estimation error - parsing failed:', error.message)
        throw error
      }
      console.error('OpenAI estimation error:', error)
      throw new Error(`Failed to estimate price with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async prepareImages(images: string[]): Promise<string[]> {
    const preparedImages: string[] = []

    for (const image of images.slice(0, 3)) {
      if (image.startsWith('http')) {
        preparedImages.push(image)
      } else {
        const fileData = await this.readImageFile(image)
        if (fileData) {
          preparedImages.push(`data:${fileData.mimeType};base64,${fileData.base64}`)
        }
      }
    }

    return preparedImages
  }

  private async prepareImagesForPreEstimate(images: string[]): Promise<string[]> {
    const preparedImages: string[] = []

    for (const image of images.slice(0, 2)) {
      if (image.startsWith('http')) {
        preparedImages.push(image)
      } else {
        const fileData = await this.readImageFile(image)
        if (fileData) {
          preparedImages.push(`data:${fileData.mimeType};base64,${fileData.base64}`)
        }
      }
    }

    return preparedImages
  }


  private async prepareReferenceImages(
    referenceProducts: ReferenceProduct[]
  ): Promise<Map<number, string>> {
    const preparedImages = new Map<number, string>()
    this.uploadedReferenceImageUrls = []

    const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary'

    for (let i = 0; i < Math.min(referenceProducts.length, 5); i++) {
      const ref = referenceProducts[i]
      if (ref.imageUrls && ref.imageUrls.length > 0) {
        const imageUrl = ref.imageUrls[0]
        if (imageUrl.startsWith('http')) {
          if (isCloudinary && this.storageService) {
            try {
              const cloudinaryUrl = await this.storageService.saveImage(
                imageUrl,
                `reference_${ref.url.split('/').pop() || 'unknown'}`,
                0
              )
              preparedImages.set(i, cloudinaryUrl)
              this.uploadedReferenceImageUrls.push(cloudinaryUrl)
            } catch (error) {
              console.error(
                `Failed to upload reference image ${imageUrl}:`,
                error
              )
              preparedImages.set(i, imageUrl)
            }
          } else {
            preparedImages.set(i, imageUrl)
          }
        }
      }
    }

    return preparedImages
  }

  async cleanupReferenceImages(): Promise<void> {
    if (this.storageService && this.uploadedReferenceImageUrls.length > 0) {
      for (const url of this.uploadedReferenceImageUrls) {
        try {
          await this.storageService.deleteImage(url)
        } catch (error) {
          console.error(`Failed to delete reference image ${url}:`, error)
        }
      }
      this.uploadedReferenceImageUrls = []
    }
  }
}