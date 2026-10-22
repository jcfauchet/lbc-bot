import Anthropic from '@anthropic-ai/sdk'
import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'
import { buildCompVerifyPrompt, parseCompVerdicts } from '../comp-verify-prompt'
import { CLAUDE_JUDGE_MODEL, imageBlock, responseText } from './claude-message'

/** Same bound as the Gemini verifier: Lens rarely yields more priced value comps anyway. */
const MAX_CANDIDATES = 8

/** Claude twin of GeminiCompVerifier: keeps only the comparables showing the same model as the ad. */
export class ClaudeCompVerifier implements ICompVerifier {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model = CLAUDE_JUDGE_MODEL) {
    this.client = new Anthropic({ apiKey })
  }

  async verify(input: CompVerifyInput): Promise<CompMatch[]> {
    const candidates = input.comps.filter((c) => c.imageUrl).slice(0, MAX_CANDIDATES)
    if (candidates.length === 0) return []

    const images = await Promise.all([input.listingImageUrl, ...candidates.map((c) => c.imageUrl!)].map(imageBlock))
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildCompVerifyPrompt({ listingTitle: input.listingTitle, compCount: candidates.length }) },
          ...images,
        ],
      }],
    })
    const flags = parseCompVerdicts(responseText(response, 'the comp check'), candidates.length)
    return candidates.filter((_, i) => flags[i])
  }
}
