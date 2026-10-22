import Anthropic from '@anthropic-ai/sdk'
import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore, renderListingContext } from '../triage-prompt'
import { fetchImage } from '../fetch-image'

export interface ClaudeTriageOptions {
  model?: string
  /** Thinking depth; billed as output tokens. Triage is a one-line classification, so low by default. */
  effort?: 'low' | 'medium' | 'high'
}

const DEFAULT_TRIAGE_MODEL = 'claude-haiku-5-5'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export class ClaudeTriageService implements ITriageService {
  readonly providerName = 'claude'
  private readonly client: Anthropic
  private readonly model: string
  private readonly effort: NonNullable<ClaudeTriageOptions['effort']>

  constructor(apiKey: string, options: ClaudeTriageOptions = {}) {
    this.client = new Anthropic({ apiKey })
    this.model = options.model ?? DEFAULT_TRIAGE_MODEL
    this.effort = options.effort ?? 'low'
  }

  async triage(input: TriageInput, guidance?: string | null): Promise<TriageResult> {
    const image = await fetchImage(input.imageUrl)
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: this.effort },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mimeType as ImageMediaType, data: image.data } },
          { type: 'text', text: `${buildTriagePrompt(guidance)}\n${renderListingContext(input)}` },
        ],
      }],
    })
    if (response.stop_reason === 'refusal') throw new Error(`Claude refused triage for "${input.title}"`)
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return parseTriageScore(text)
  }
}
