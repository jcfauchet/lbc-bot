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
  private readonly MODEL_NAME = 'gemini-2.5-pro'
  private storageService?: IStorageService
  private uploadedReferenceImageUrls: string[] = []

  constructor(apiKey: string, storageService?: IStorageService) {
    super()
    this.ai = new GoogleGenAI({ apiKey })
    this.storageService = storageService
  }

  async preEstimate(
    images: string[],
    title: string,
    description?: string,
    categories?: string[]
  ): Promise<PreEstimationResult> {
    try {
      const imageParts = await this.prepareImages(images)
      const prompt = this.buildPreEstimationPrompt(title, description, categories)

      const generationConfig: GenerateContentParameters['config'] = {
        temperature: 0.2,
      }

      const tools = [{ googleSearch: {} }]

      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        contents: [
          {
            role: 'user',
            parts: [{ text: this.getSystemInstruction() }, { text: prompt }, ...imageParts],
          },
        ],
        config: {
          ...generationConfig,
          tools: tools,
        },
      })

      const content = response.text || ''
      if (!content) {
        console.error('Gemini returned empty content')
        throw new Error('Gemini returned empty response')
      }
      return this.parsePreEstimationResponse(content)
    } catch (error) {
      console.error('Gemini pre-estimation error:', error)
      throw new Error(`Failed to pre-estimate with Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async analyzeForSearch(
    images: string[],
    title: string,
    description?: string
  ): Promise<SearchAnalysisResult> {
    try {
      const imageParts = await this.prepareImages(images)
      const prompt = this.buildSearchPrompt(title, description)

      const generationConfig: GenerateContentParameters['config'] = {
        temperature: 0.2,
      }

      const tools = [{ googleSearch: {} }]

      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        contents: [
          {
            role: 'user',
            parts: [{ text: this.getSystemInstruction() }, { text: prompt }, ...imageParts],
          },
        ],
        config: {
          ...generationConfig,
          tools: tools,
        },
      })

      const content = response.text || ''
      if (!content) {
        throw new Error('Gemini returned empty response')
      }
      return this.parseSearchResponse(content)
    } catch (error) {
      console.error('Gemini search analysis error:', error)
      throw new Error(`Failed to analyze for search with Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts: ReferenceProduct[] = []
  ): Promise<FinalEstimationResult> {
    try {
      const imageParts = await this.prepareImages(images)
      const referenceImageParts = await this.prepareReferenceImages(referenceProducts)
      const prompt = this.buildPrompt(title, description, referenceProducts)

      const generationConfig: GenerateContentParameters['config'] = {
          temperature: 0.2,
      }

      const tools = [{ googleSearch: {} }]

      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        contents: [
          {
            role: 'user',
            parts: [{ text: this.getSystemInstruction() }, { text: prompt }, ...imageParts, ...referenceImageParts],
          },
        ],
        config: {
          ...generationConfig,
          tools: tools,
        },
      })

      const content = response.text || ''
      if (!content) {
        console.error('Gemini returned empty content')
        throw new Error('Gemini returned empty response')
      }
      return this.parseFinalEstimationResponse(content, referenceProducts)
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

  private async prepareReferenceImages(referenceProducts: ReferenceProduct[]): Promise<Part[]> {
    const preparedParts: Part[] = []
    this.uploadedReferenceImageUrls = []

    const isCloudinary = process.env.STORAGE_TYPE === 'cloudinary'

    for (const ref of referenceProducts.slice(0, 5)) {
      if (ref.imageUrls && ref.imageUrls.length > 0) {
        for (const imageUrl of ref.imageUrls.slice(0, 1)) {
          if (imageUrl.startsWith('http')) {
            try {
              let finalUrl = imageUrl
              
              if (isCloudinary && this.storageService) {
                try {
                  const cloudinaryUrl = await this.storageService.saveImage(
                    imageUrl,
                    `reference_${ref.url.split('/').pop() || 'unknown'}`,
                    0
                  )
                  finalUrl = cloudinaryUrl
                  this.uploadedReferenceImageUrls.push(cloudinaryUrl)
                } catch (error) {
                  console.error(`Failed to upload reference image ${imageUrl}:`, error)
                }
              }

              const response = await fetch(finalUrl)
              const buffer = await response.arrayBuffer()
              const base64 = Buffer.from(buffer).toString('base64')
              const mimeType = response.headers.get('content-type') || 'image/jpeg'
              preparedParts.push({
                inlineData: {
                  data: base64,
                  mimeType: mimeType,
                },
              })
            } catch (error) {
              console.error(`Failed to fetch reference image ${imageUrl}:`, error)
            }
          }
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