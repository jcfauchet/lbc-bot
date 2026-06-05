import { GoogleGenAI } from '@google/genai'
import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'
import { TRIAGE_PROMPT, parseTriageScore } from '../triage-prompt'

export class GeminiTriageService implements ITriageService {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async triage(imageUrl: string, title: string): Promise<TriageResult> {
    const imageBytes = Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64')
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${TRIAGE_PROMPT}\nListing title: ${title}` },
        { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
      ],
    })
    return parseTriageScore(response.text ?? '')
  }
}
