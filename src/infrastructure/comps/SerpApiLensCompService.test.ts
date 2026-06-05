import { describe, it, expect, vi, afterEach } from 'vitest'
import { SerpApiLensCompService } from './SerpApiLensCompService'

afterEach(() => vi.restoreAllMocks())

describe('SerpApiLensCompService', () => {
  it('maps visual_matches to CompMatch with value-domain + price', async () => {
    const payload = {
      visual_matches: [
        { title: 'Willy Rizzo Alveo', link: 'https://www.1stdibs.com/x', source: '1stDibs',
          price: { value: '$7,855', extracted_value: 7855, currency: '$' } },
        { title: 'Coffee table', link: 'https://youtube.com/y', source: 'YouTube' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

    const svc = new SerpApiLensCompService('FAKE_KEY')
    const { matches } = await svc.findComps('https://img/x.jpg')

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({
      isValueDomain: true,
      price: { value: 7855, currency: 'USD' },
    })
    expect(matches[1].isValueDomain).toBe(false)
    expect(matches[1].price).toBeUndefined()
  })

  it('throws on SerpAPI error payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 200 })))
    const svc = new SerpApiLensCompService('FAKE_KEY')
    await expect(svc.findComps('https://img/x.jpg')).rejects.toThrow(/SerpAPI/)
  })
})
