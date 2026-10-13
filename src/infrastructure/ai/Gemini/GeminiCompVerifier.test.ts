import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompMatch } from '@/domain/services/ICompService'

type Request = { model: string; contents: Array<{ text?: string; inlineData?: unknown }> }
const generateContent = vi.fn(async (_request: Request) => ({ text: '{"confirmed": [2]}' }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent } } }))
vi.mock('../fetch-image', () => ({ fetchImage: vi.fn(async (url: string) => ({ mimeType: 'image/jpeg', data: `img:${url}` })) }))

import { GeminiCompVerifier } from './GeminiCompVerifier'

const comp = (link: string, imageUrl?: string): CompMatch => ({
  title: link, link, source: 'selency', isValueDomain: true, price: { value: 500, currency: 'EUR' }, imageUrl,
})

describe('GeminiCompVerifier', () => {
  beforeEach(() => generateContent.mockClear())

  it('keeps only the comparables the model confirms as the same model', async () => {
    const comps = [comp('a', 'https://t/a'), comp('b', 'https://t/b'), comp('c', 'https://t/c')]
    const kept = await new GeminiCompVerifier('key').verify({ listingImageUrl: 'https://img/ad.jpg', listingTitle: 'Table', comps })
    expect(kept.map((c) => c.link)).toEqual(['b'])
    const call = generateContent.mock.calls[0][0]
    expect(call.model).toBe('gemini-3.6-flash')
    expect(call.contents.filter((p) => p.inlineData)).toHaveLength(4)
  })

  it('cannot vouch for a comparable without a thumbnail, so it drops it', async () => {
    const kept = await new GeminiCompVerifier('key').verify({ listingImageUrl: 'https://img/ad.jpg', listingTitle: 'Table', comps: [comp('a'), comp('b', 'https://t/b')] })
    expect(generateContent).toHaveBeenCalledOnce()
    // Only 'b' was shown, as candidate 1; the mock confirms candidate 2, which does not exist.
    expect(kept).toEqual([])
  })

  it('skips the call when nothing can be verified', async () => {
    const kept = await new GeminiCompVerifier('key').verify({ listingImageUrl: 'https://img/ad.jpg', listingTitle: 'Table', comps: [comp('a')] })
    expect(kept).toEqual([])
    expect(generateContent).not.toHaveBeenCalled()
  })
})
