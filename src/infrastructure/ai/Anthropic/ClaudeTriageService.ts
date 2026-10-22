import Anthropic from '@anthropic-ai/sdk'
import type { ITriageService, TriageInput, TriageResult } from '@/domain/services/ITriageService'
import { buildTriagePrompt, parseTriageScore, renderListingContext } from '../triage-prompt'
import { imageBlock, responseText } from './claude-message'

export interface ClaudeTriageOptions {
  model?: string
  /** Thinking depth; billed as output tokens. Triage is a one-line classification, so low by default. */
  effort?: 'low' | 'medium' | 'high'
}

const DEFAULT_TRIAGE_MODEL = 'claude-haiku-5-5'

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
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: this.effort },
      messages: [{
        role: 'user',
        content: [
          await imageBlock(input.imageUrl),
          { type: 'text', text: `${buildTriagePrompt(guidance)}\n${renderListingContext(input)}` },
        ],
      }],
    })
    return parseTriageScore(responseText(response, `triage for "${input.title}"`))
  }
}
