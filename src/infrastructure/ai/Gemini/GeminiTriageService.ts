import { GoogleGenAI } from '@google/genai'
import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore, renderListingContext } from '../triage-prompt'

export class GeminiTriageService implements ITriageService {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async triage(input: TriageInput, guidance?: string | null): Promise<TriageResult> {
    const imageBytes = Buffer.from(await (await fetch(input.imageUrl)).arrayBuffer()).toString('base64')
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${buildTriagePrompt(guidance)}\n${renderListingContext(input)}` },
        { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
      ],
    })
    return parseTriageScore(response.text ?? '')
  }
}
