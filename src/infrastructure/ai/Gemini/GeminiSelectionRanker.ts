import { GoogleGenAI } from '@google/genai'
import type { ISelectionRanker, RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'
import { buildRankingPrompt, parseRanking, renderCandidateList } from '../ranking-prompt'

export class GeminiSelectionRanker implements ISelectionRanker {
  readonly providerName = 'gemini'
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]> {
    // A single unreachable image must not sink the whole batch: that candidate is
    // dropped and the others are still ranked. Numbering follows the surviving
    // list so the model's answers keep pointing at the right listing.
    const usable: RankingCandidate[] = []
    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    for (const candidate of candidates) {
      let imageBytes: string
      try {
        imageBytes = Buffer.from(await (await fetch(candidate.imageUrl)).arrayBuffer()).toString('base64')
      } catch {
        continue
      }
      usable.push(candidate)
      imageParts.push({ text: `Candidate ${usable.length}:` })
      imageParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBytes } })
    }
    if (usable.length === 0) return []

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `${buildRankingPrompt(guidance)}\n\n${renderCandidateList(usable)}` },
        ...imageParts,
      ],
    })

    const picks = parseRanking(response.text ?? '', usable)
    // Unparseable output is a broken call, not an abstention. Throwing lets the use
    // case fall back to its deterministic order instead of silently spending nothing.
    if (picks === null) throw new Error('Ranking response could not be parsed')
    return picks
  }
}
