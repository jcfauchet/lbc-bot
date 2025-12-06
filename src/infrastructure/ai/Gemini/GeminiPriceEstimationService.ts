import {
  PriceEstimationResult,
  ReferenceProduct,
  PreEstimationResult,
  FinalEstimationResult,
  SearchAnalysisResult,
} from '@/domain/services/IPriceEstimationService'
import {
  GoogleGenAI,
  Part,
  GenerateContentParameters,
} from '@google/genai'
import { BasePriceEstimationService } from '../BasePriceEstimationService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'

export class GeminiPriceEstimationService extends BasePriceEstimationService {
  public readonly providerName = 'gemini'
  private ai: GoogleGenAI
  private readonly MODEL_NAME = 'gemini-3-pro-preview'
  private storageService?: IStorageService
  private uploadedReferenceImageUrls: string[] = []

  constructor(apiKey: string, storageService?: IStorageService) {
    super()
    this.ai = new GoogleGenAI({ apiKey })
    this.storageService = storageService
  }

  async estimatePrice(
    images: string[],
    title: string,
    description?: string,
  ): Promise<FinalEstimationResult> {
    try {
      const imageParts = await this.prepareImages(images)

      const userParts: Part[] = [
        { text: this.getSystemInstruction() },
        { text: this.buildUserContext(title, description) },
        ...imageParts,
        { text: this.getAnalysisInstructions() },
      ]

      const generationConfig: GenerateContentParameters['config'] = {
        temperature: 0.2,
      }

      const tools = [{ googleSearch: {} }]

      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        contents: [
          {
            role: 'user',
            parts: userParts,
          },
        ],
        config: {
          ...generationConfig,
          tools: tools,
        },
      })

      console.log(response.text)

      const content = response.text || ''
      if (!content) {
        console.error('Gemini returned empty content')
        throw new Error('Gemini returned empty response')
      }
      return this.parseFinalEstimationResponse(content)
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid response format')) {
        console.error('Gemini estimation error - parsing failed:', error.message)
        throw error
      }
      console.error('Gemini estimation error:', error)
      throw new Error(`Failed to estimate price with Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async prepareImages(images: string[]): Promise<Part[]> {
    const preparedParts: Part[] = []

    for (const image of images.slice(0, 3)) {
      if (image.startsWith('http')) {
        const response = await fetch(image)
        const buffer = await response.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        const mimeType = response.headers.get('content-type') || 'image/jpeg'
        preparedParts.push({
          inlineData: {
            data: base64,
            mimeType: mimeType,
          },
        })
      } else {
        const fileData = await this.readImageFile(image)
        if (fileData) {
          preparedParts.push({
            inlineData: {
              data: fileData.base64,
              mimeType: fileData.mimeType,
            },
          })
        }
      }
    }

    return preparedParts
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