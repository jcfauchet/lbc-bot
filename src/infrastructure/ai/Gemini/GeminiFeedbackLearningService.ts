import { GoogleGenAI } from '@google/genai'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { FeedbackDigestItem } from '@/domain/repositories/IFeedbackRepository'
import { buildDistilRequest } from '../feedback-distil-prompt'
import { geminiUsage, recordAiUsage } from '../ai-usage'

export class GeminiFeedbackLearningService implements IFeedbackLearningService {
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async distil(negative: FeedbackDigestItem[], positive: FeedbackDigestItem[]): Promise<string> {
    const request = buildDistilRequest(negative, positive)
    if (!request) return ''

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: request }],
    })
    recordAiUsage('feedback_learning', this.model, geminiUsage(response.usageMetadata))

    return (response.text ?? '').trim()
  }
}
