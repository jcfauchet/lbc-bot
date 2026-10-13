import { GoogleGenAI } from '@google/genai'
import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore, renderListingContext } from '../triage-prompt'

export interface GeminiTriageOptions {
  model?: string
  /** 0 turns thinking off; unset leaves the model's default. Billed as output tokens. */
  thinkingBudget?: number
}

/**
 * Triage is the funnel's volume driver (~650 calls/day), so it stays on the
 * cheapest Flash until an eval shows a newer model earns its price.
 */
const DEFAULT_TRIAGE_MODEL = 'gemini-2.5-flash'

export class GeminiTriageService implements ITriageService {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string
  private readonly thinkingBudget: number | undefined

  constructor(apiKey: string, options: GeminiTriageOptions = {}) {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = options.model ?? DEFAULT_TRIAGE_MODEL
    this.thinkingBudget = options.thinkingBudget
  }

  async triage(input: TriageInput, guidance?: string | null): Promise<TriageResult> {
    const imageBytes = Buffer.from(await (await fetch(input.imageUrl)).arrayBuffer()).toString('base64')
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${buildTriagePrompt(guidance)}\n${renderListingContext(input)}` },
        { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
      ],
      ...(this.thinkingBudget === undefined ? {} : { config: { thinkingConfig: { thinkingBudget: this.thinkingBudget } } }),
    })
    return parseTriageScore(response.text ?? '')
  }
}
