import { describe, it, expect } from 'vitest'
import { GeminiImageEmbeddingService } from './GeminiImageEmbeddingService'

describe('GeminiImageEmbeddingService (live)', () => {
  it('returns a 768-dim vector for a real photo', async () => {
    const key = process.env.GOOGLE_GEMINI_API_KEY
    if (!key) throw new Error('GOOGLE_GEMINI_API_KEY required')
    const vector = await new GeminiImageEmbeddingService(key).embedImage(
      // A Leboncoin CDN photo: the kind of image the stage actually embeds.
      'https://img.leboncoin.fr/api/v1/lbcpb1/images/eb/40/15/eb4015d6e7fbb55bb1e17e6684297df83e800693.jpg?rule=ad-small',
    )
    expect(vector).toHaveLength(768)
  })
})
