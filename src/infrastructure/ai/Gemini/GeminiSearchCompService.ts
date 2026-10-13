import { GoogleGenAI } from '@google/genai'
import type { CompContext, CompResult, ICompService } from '@/domain/services/ICompService'
import { buildCompSearchPrompt, parseCompSearchResult } from '../comp-search-prompt'
import { fetchImage } from '../fetch-image'

/**
 * Comparables through Gemini with Google Search grounding: the model identifies
 * the piece from the photo and the ad text, then searches dealer and auction
 * sites for the same model. Text-first, unlike the Lens reverse-image search,
 * so it needs the ad context to do better than a visual look-alike.
 */
export class GeminiSearchCompService implements ICompService {
  readonly providerName = 'gemini-google-search'
  private readonly ai: GoogleGenAI

  constructor(apiKey: string, private readonly model = 'gemini-3.6-flash') {
    this.ai = new GoogleGenAI({ apiKey })
  }

  async findComps(imageUrl: string, context?: CompContext): Promise<CompResult> {
    const image = await fetchImage(imageUrl)
    const prompt = buildCompSearchPrompt(context ?? { title: '', priceEur: 0 })
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: prompt }, { inlineData: image }],
      config: { tools: [{ googleSearch: {} }] },
    })
    return { matches: parseCompSearchResult(response.text ?? '') }
  }
}
