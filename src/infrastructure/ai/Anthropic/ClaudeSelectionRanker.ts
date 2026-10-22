import Anthropic from '@anthropic-ai/sdk'
import type { ISelectionRanker, RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'
import { buildRankingPrompt, parseRanking, renderCandidateList } from '../ranking-prompt'
import { CLAUDE_JUDGE_MODEL, imageBlock, responseText } from './claude-message'

export class ClaudeSelectionRanker implements ISelectionRanker {
  readonly providerName = 'claude'
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model = CLAUDE_JUDGE_MODEL) {
    this.client = new Anthropic({ apiKey })
  }

  async rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]> {
    // As in the Gemini ranker: an unreachable image drops that candidate only, and
    // numbering follows the surviving list so answers point at the right listing.
    const usable: RankingCandidate[] = []
    const imageParts: Anthropic.ContentBlockParam[] = []
    for (const candidate of candidates) {
      let image: Anthropic.ImageBlockParam
      try {
        image = await imageBlock(candidate.imageUrl)
      } catch {
        continue
      }
      usable.push(candidate)
      imageParts.push({ type: 'text', text: `Candidate ${usable.length}:` }, image)
    }
    if (usable.length === 0) throw new Error('All candidate images failed to fetch')

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `${buildRankingPrompt(guidance)}\n\n${renderCandidateList(usable)}` }, ...imageParts],
      }],
    })

    const picks = parseRanking(responseText(response, 'the ranking'), usable)
    if (picks === null) throw new Error('Ranking response could not be parsed')
    return picks
  }
}
