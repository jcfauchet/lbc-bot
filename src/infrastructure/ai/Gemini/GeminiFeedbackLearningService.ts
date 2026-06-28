import { GoogleGenAI } from '@google/genai'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { FeedbackDigestItem } from '@/domain/repositories/IFeedbackRepository'

const DISTIL_PROMPT = [
  'You analyse past feedback from a vintage furniture & decor reseller.',
  'Each item is a listing that was notified as a "good deal"; the user then judged it',
  'either WORTH it (liked) or NOT worth it (rejected).',
  'Distil the recurring patterns into a SHORT actionable checklist a visual triage model can apply.',
  'Output exactly two sections, each only if it has rules:',
  'LOWER the score when the piece matches:',
  '- <rule>',
  'RAISE the score when the piece matches:',
  '- <rule>',
  'Rules:',
  '- At most 12 bullet lines total, each starting with "- ".',
  '- Generalise; keep only patterns that appear more than once or are clearly important.',
  '- Focus on visual / price signals the triager can act on, not one-off specifics.',
  '- Keep the two section headers exactly as written above. No other preamble or closing remarks.',
].join('\n')

function renderItems(items: FeedbackDigestItem[]): string {
  return items
    .map((f, i) => {
      const price = (f.priceCents / 100).toFixed(0)
      const parts = [`${i + 1}. "${f.listingTitle}" (${price}€)`]
      if (f.aiDescription) parts.push(`   estimate: ${f.aiDescription}`)
      if (f.comment) parts.push(`   user reason: ${f.comment}`)
      return parts.join('\n')
    })
    .join('\n')
}

export class GeminiFeedbackLearningService implements IFeedbackLearningService {
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async distil(negative: FeedbackDigestItem[], positive: FeedbackDigestItem[]): Promise<string> {
    if (negative.length === 0 && positive.length === 0) return ''

    const sections: string[] = []
    if (negative.length > 0) sections.push(`Rejected (NOT worth it) listings:\n${renderItems(negative)}`)
    if (positive.length > 0) sections.push(`Liked (worth it) listings:\n${renderItems(positive)}`)

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: `${DISTIL_PROMPT}\n\n${sections.join('\n\n')}` }],
    })

    return (response.text ?? '').trim()
  }
}
