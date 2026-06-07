import { GoogleGenAI } from '@google/genai'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { NegativeFeedbackItem } from '@/domain/repositories/IFeedbackRepository'

const DISTIL_PROMPT = [
  'You analyse negative feedback from a vintage furniture & decor reseller.',
  'Each item below is a listing that was notified as a "good deal" but the user judged it NOT worth it.',
  'Distil the recurring reasons into a SHORT actionable checklist a visual triage model can apply',
  'to AVOID similar false positives in the future.',
  'Rules:',
  '- Output at most 15 concise bullet lines, each starting with "- ".',
  '- Generalise; keep only patterns that appear more than once or are clearly important.',
  '- Focus on visual / price signals the triager can act on, not one-off specifics.',
  '- No preamble, no numbering, no closing remarks. Bullet lines only.',
].join('\n')

export class GeminiFeedbackLearningService implements IFeedbackLearningService {
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async distil(feedbacks: NegativeFeedbackItem[]): Promise<string> {
    if (feedbacks.length === 0) return ''

    const items = feedbacks
      .map((f, i) => {
        const price = (f.priceCents / 100).toFixed(0)
        const parts = [`${i + 1}. "${f.listingTitle}" (${price}€)`]
        if (f.aiDescription) parts.push(`   estimate: ${f.aiDescription}`)
        if (f.comment) parts.push(`   user reason: ${f.comment}`)
        return parts.join('\n')
      })
      .join('\n')

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: `${DISTIL_PROMPT}\n\nFeedback items:\n${items}` }],
    })

    return (response.text ?? '').trim()
  }
}
