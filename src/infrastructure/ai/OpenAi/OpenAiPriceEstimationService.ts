import OpenAI from 'openai'
import {
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

      const fullPrompt = [
        this.getSystemInstruction(),
        this.buildUserContext(title, description),
        this.getAnalysisInstructions(),
        'Use the web_search only if you are not sure about the price of the item.'
      ].join('\n\n')

      const inputContent = [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: fullPrompt },
            ...imageContents.map((url) => ({
              type: 'input_image',
              image_url: url,
            })),
          ],
        },
      ]

      const response = await (this.client as any).responses.create({
        model: 'gpt-5',
        tools: [{ type: 'web_search' }],
        input: inputContent,
      })

      let content = ''
      
      if (response.output_text && typeof response.output_text === 'string') {
        content = response.output_text
      } else if (response.output && Array.isArray(response.output)) {
        const messageItem = response.output.find((item: any) => item.type === 'message' && item.content)
        if (messageItem && Array.isArray(messageItem.content)) {
          const textItem = messageItem.content.find((item: any) => item.type === 'output_text' && item.text)
          if (textItem && textItem.text) {
            content = textItem.text
          }
        }
      }

      if (!content || typeof content !== 'string') {
        console.error('OpenAI returned invalid content structure:', JSON.stringify(response, null, 2))
        throw new Error('OpenAI returned empty or invalid response')
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