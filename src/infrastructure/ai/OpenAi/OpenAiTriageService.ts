import OpenAI from 'openai'
import type { ITriageService, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore } from '../triage-prompt'

export class OpenAiTriageService implements ITriageService {
  readonly providerName = 'openai'
  private readonly client: OpenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey })
    this.model = model
  }

  async triage(imageUrl: string, title: string, guidance?: string | null): Promise<TriageResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${buildTriagePrompt(guidance)}\nListing title: ${title}` },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    })
    return parseTriageScore(completion.choices[0]?.message?.content ?? '')
  }
}
