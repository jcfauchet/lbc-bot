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
    description?: string
  ): Promise<PreEstimationResult> {
    try {
      const imageContents = await this.prepareImages(images)
      const prompt = this.buildPreEstimationPrompt(title, description)

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
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
        max_tokens: 2000,
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
        model: 'gpt-4o',
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
        max_tokens: 1000,
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
      const referenceImageContents = await this.prepareReferenceImages(referenceProducts)
      const prompt = this.buildPrompt(title, description, referenceProducts)

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
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
              ...referenceImageContents.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          },
        ],
        max_tokens: 1000,
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


  private async prepareReferenceImages(referenceProducts: ReferenceProduct[]): Promise<string[]> {
    const preparedImages: string[] = []
    this.uploadedReferenceImageUrls = []

    const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary'

    for (const ref of referenceProducts.slice(0, 5)) {
      if (ref.imageUrls && ref.imageUrls.length > 0) {
        for (const imageUrl of ref.imageUrls.slice(0, 1)) {
          if (imageUrl.startsWith('http')) {
            if (isCloudinary && this.storageService) {
              try {
                const cloudinaryUrl = await this.storageService.saveImage(
                  imageUrl,
                  `reference_${ref.url.split('/').pop() || 'unknown'}`,
                  0
                )
                preparedImages.push(cloudinaryUrl)
                this.uploadedReferenceImageUrls.push(cloudinaryUrl)
              } catch (error) {
                console.error(`Failed to upload reference image ${imageUrl}:`, error)
                preparedImages.push(imageUrl)
              }
            } else {
              preparedImages.push(imageUrl)
            }
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