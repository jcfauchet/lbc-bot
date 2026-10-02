import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'

export const IMAGE_EMBEDDING_DIMENSIONS = 768

/**
 * Calls the REST endpoint directly: @google/genai 1.30 only embeds text parts,
 * and moving to 2.x is a major bump touching triage and ranking.
 */
export class GeminiImageEmbeddingService implements IImageEmbeddingService {
  constructor(
    private readonly apiKey: string,
    private readonly dimensions = IMAGE_EMBEDDING_DIMENSIONS,
    private readonly model = 'gemini-embedding-2-preview',
  ) {}

  async embedImage(imageUrl: string): Promise<number[]> {
    const image = await fetch(imageUrl)
    if (!image.ok) throw new Error(`Image download failed (${image.status}) for ${imageUrl}`)
    const mimeType = image.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    const data = Buffer.from(await image.arrayBuffer()).toString('base64')

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          content: { parts: [{ inline_data: { mime_type: mimeType, data } }] },
          output_dimensionality: this.dimensions,
        }),
      },
    )
    const json = (await response.json()) as { embedding?: { values?: number[] }; error?: { message?: string } }
    if (!response.ok || !json.embedding?.values) {
      throw new Error(`Gemini embedContent ${response.status}: ${json.error?.message ?? 'no embedding returned'}`)
    }
    return json.embedding.values
  }
}
