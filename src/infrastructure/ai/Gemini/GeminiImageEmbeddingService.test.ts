import { describe, it, expect, vi, afterEach } from 'vitest'
import { GeminiImageEmbeddingService } from './GeminiImageEmbeddingService'

afterEach(() => vi.unstubAllGlobals())

describe('GeminiImageEmbeddingService', () => {
  it('downloads the image and posts it inline to embedContent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: { values: [0.1, 0.2] } })))
    vi.stubGlobal('fetch', fetchMock)

    const vector = await new GeminiImageEmbeddingService('key', 2).embedImage('https://img/x.png')

    expect(vector).toEqual([0.1, 0.2])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent')
    expect(init.headers['x-goog-api-key']).toBe('key')
    const body = JSON.parse(init.body)
    expect(body.content.parts[0].inline_data).toEqual({ mime_type: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') })
    expect(body.output_dimensionality).toBe(2)
  })

  it('throws with the API message when Gemini refuses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })))

    await expect(new GeminiImageEmbeddingService('bad').embedImage('https://img/x.jpg'))
      .rejects.toThrow('Gemini embedContent 400: API key not valid')
  })

  it('throws when the image download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('nope', { status: 404 })))
    await expect(new GeminiImageEmbeddingService('key').embedImage('https://img/gone.jpg'))
      .rejects.toThrow('Image download failed (404)')
  })
})
