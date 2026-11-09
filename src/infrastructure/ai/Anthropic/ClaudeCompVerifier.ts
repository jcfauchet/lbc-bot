import Anthropic from '@anthropic-ai/sdk'
import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'
import {
  buildCompVerifyRequest, compCandidates, parseCompVerdicts, parseTieredCompVerdicts,
  TIERED_COMP_VERIFY_INSTRUCTIONS, type CompTier,
} from '../comp-verify-prompt'
import { CLAUDE_JUDGE_MODEL, responseText } from './claude-message'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** Claude twin of GeminiCompVerifier: keeps only the comparables showing the same model as the ad. */
export class ClaudeCompVerifier implements ICompVerifier {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model = CLAUDE_JUDGE_MODEL) {
    this.client = new Anthropic({ apiKey })
  }

  async verify(input: CompVerifyInput): Promise<CompMatch[]> {
    const candidates = compCandidates(input.comps)
    if (candidates.length === 0) return []
    const flags = parseCompVerdicts(await this.ask(input, candidates), candidates.length)
    return candidates.filter((_, i) => flags[i])
  }

  /** Graded verdict for each comp `compCandidates` shows, in that order (backtests only). */
  async tiers(input: CompVerifyInput): Promise<Array<{ comp: CompMatch; tier: CompTier }>> {
    const candidates = compCandidates(input.comps)
    if (candidates.length === 0) return []
    const tiers = parseTieredCompVerdicts(await this.ask(input, candidates, TIERED_COMP_VERIFY_INSTRUCTIONS), candidates.length)
    return candidates.map((comp, i) => ({ comp, tier: tiers[i] }))
  }

  private async ask(input: CompVerifyInput, candidates: CompMatch[], instructions?: string): Promise<string> {
    const parts = await buildCompVerifyRequest({ listingTitle: input.listingTitle, listingImageUrls: input.listingImageUrls, candidates }, instructions)
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{
        role: 'user',
        content: parts.map((p): Anthropic.ContentBlockParam => ('text' in p
          ? { type: 'text', text: p.text }
          : { type: 'image', source: { type: 'base64', media_type: p.image.mimeType as ImageMediaType, data: p.image.data } })),
      }],
    })
    return responseText(response, 'the comp check')
  }
}
