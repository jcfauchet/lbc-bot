import OpenAI from 'openai'
import { recordAiUsage } from '../ai-usage'
import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore, renderListingContext } from '../triage-prompt'

export class OpenAiTriageService implements ITriageService {
  readonly providerName = 'openai'
  private readonly client: OpenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey })
    this.model = model
  }

  async triage(input: TriageInput, guidance?: string | null): Promise<TriageResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${buildTriagePrompt(guidance)}\n${renderListingContext(input)}` },
          { type: 'image_url', image_url: { url: input.imageUrl } },
        ],
      }],
    })
    recordAiUsage('triage', this.model, { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 })
    return parseTriageScore(completion.choices[0]?.message?.content ?? '')
  }
}
