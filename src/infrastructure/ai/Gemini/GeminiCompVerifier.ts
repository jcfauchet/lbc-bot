import { GoogleGenAI } from '@google/genai'
import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'
import { buildCompVerifyRequest, compCandidates, parseCompVerdicts } from '../comp-verify-prompt'

/**
 * Looks at the ad photos next to each comparable's photos and keeps only the
 * ones showing the same model. A reverse-image search returns look-alikes, and
 * a look-alike from a dealer site used to price the piece as if it were the
 * real thing.
 */
export class GeminiCompVerifier implements ICompVerifier {
  private readonly ai: GoogleGenAI

  constructor(apiKey: string, private readonly model = 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey })
  }

  async verify(input: CompVerifyInput): Promise<CompMatch[]> {
    const candidates = compCandidates(input.comps)
    if (candidates.length === 0) return []

    const parts = await buildCompVerifyRequest({ listingTitle: input.listingTitle, listingImageUrls: input.listingImageUrls, candidates })
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: p.image })),
    })
    const flags = parseCompVerdicts(response.text ?? '', candidates.length)
    return candidates.filter((_, i) => flags[i])
  }
}
