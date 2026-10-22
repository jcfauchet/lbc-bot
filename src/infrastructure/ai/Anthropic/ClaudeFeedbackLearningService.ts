import Anthropic from '@anthropic-ai/sdk'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { FeedbackDigestItem } from '@/domain/repositories/IFeedbackRepository'
import { buildDistilRequest } from '../feedback-distil-prompt'
import { CLAUDE_JUDGE_MODEL, responseText } from './claude-message'

export class ClaudeFeedbackLearningService implements IFeedbackLearningService {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model = CLAUDE_JUDGE_MODEL) {
    this.client = new Anthropic({ apiKey })
  }

  async distil(negative: FeedbackDigestItem[], positive: FeedbackDigestItem[]): Promise<string> {
    const request = buildDistilRequest(negative, positive)
    if (!request) return ''

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: request }],
    })
    return responseText(response, 'the feedback distillation').trim()
  }
}
