import { GoogleGenAI } from '@google/genai'
import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'
import { buildCompVerifyPrompt, parseCompVerdicts } from '../comp-verify-prompt'
import { fetchImage } from '../fetch-image'

/** Bounds the vision tokens per call; Lens rarely yields more priced value comps anyway. */
const MAX_CANDIDATES = 8

/**
 * Looks at the ad photo next to each comparable's thumbnail and keeps only the
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
    const candidates = input.comps.filter((c) => c.imageUrl).slice(0, MAX_CANDIDATES)
    if (candidates.length === 0) return []

    const listingPart = { inlineData: await fetchImage(input.listingImageUrl) }
    const candidateParts = await Promise.all(candidates.map(async (c) => ({ inlineData: await fetchImage(c.imageUrl!) })))
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: buildCompVerifyPrompt({ listingTitle: input.listingTitle, compCount: candidates.length }) },
        listingPart,
        ...candidateParts,
      ],
    })
    const flags = parseCompVerdicts(response.text ?? '', candidates.length)
    return candidates.filter((_, i) => flags[i])
  }
}
