import { GoogleGenAI } from '@google/genai'
import type { IReferenceMatchVerifier, ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from '../reference-match-prompt'

async function toInlinePart(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`)
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  return { inlineData: { mimeType, data: Buffer.from(await response.arrayBuffer()).toString('base64') } }
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
