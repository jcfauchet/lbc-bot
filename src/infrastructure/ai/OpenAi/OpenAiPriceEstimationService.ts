import OpenAI from 'openai'
import {
  ReferenceProduct,
  SearchAnalysisResult,
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

  async estimatePrice(
    images: string[],
    title: string,
    description?: string,
  ): Promise<FinalEstimationResult> {
    try {
      const imageContents = await this.prepareImages(images)

      const userContent: any[] = [
        { type: 'text', text: this.buildUserContext(title, description) },
        ...imageContents.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
      ]

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
      return this.parseFinalEstimationResponse(content)
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