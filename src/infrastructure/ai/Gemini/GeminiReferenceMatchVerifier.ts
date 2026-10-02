import { GoogleGenAI } from '@google/genai'
import type { IReferenceMatchVerifier, ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from '../reference-match-prompt'
import { fetchImage } from '../fetch-image'

async function toInlinePart(url: string) {
  return { inlineData: await fetchImage(url) }
}

export class GeminiReferenceMatchVerifier implements IReferenceMatchVerifier {
  private readonly ai: GoogleGenAI

  constructor(apiKey: string, private readonly model = 'gemini-2.5-flash') {
    this.ai = new GoogleGenAI({ apiKey })
  }

  async verify(input: ReferenceMatchInput): Promise<ReferenceVerdict> {
    const listingParts = await Promise.all(input.listingImageUrls.map(toInlinePart))
    const referenceParts = await Promise.all(input.referenceImageUrls.map(toInlinePart))
    const prompt = buildReferenceMatchPrompt({
      listingTitle: input.listingTitle,
      referenceName: input.referenceName,
      referenceNote: input.referenceNote,
      listingImageCount: listingParts.length,
      referenceImageCount: referenceParts.length,
    })
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: prompt }, ...listingParts, ...referenceParts],
    })
    return parseReferenceVerdict(response.text ?? '')
  }
}
