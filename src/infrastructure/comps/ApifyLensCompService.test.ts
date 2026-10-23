import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApifyLensCompService } from './ApifyLensCompService'

afterEach(() => vi.unstubAllGlobals())

describe('ApifyLensCompService', () => {
  it('maps the visual matches, without prices, and authenticates with a bearer token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{
        visualMatches: [
          { link: 'https://www.pamono.com/cart', title: 'Bar cart', source: 'Pamono', thumbnail: 'https://tbn/1', imageUrl: 'https://cdn/1.jpg' },
          { link: 'https://www.amazon.fr/x', title: 'Cart', source: 'Amazon' },
        ],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { matches } = await new ApifyLensCompService('tok').findComps('https://img/ad.jpg')

    expect(matches).toEqual([
      { title: 'Bar cart', link: 'https://www.pamono.com/cart', source: 'Pamono', isValueDomain: true, isMassMarket: false, imageUrl: 'https://tbn/1', photoUrls: ['https://cdn/1.jpg'] },
      { title: 'Cart', link: 'https://www.amazon.fr/x', source: 'Amazon', isValueDomain: false, isMassMarket: true, imageUrl: undefined, photoUrls: undefined },
    ])
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string).imageUrls).toEqual(['https://img/ad.jpg'])
  })

  it('retries a failed run once, but not spent credits', async () => {
    const failedRun = { ok: false, status: 400, text: async () => '{"error":{"type":"run-failed"}}' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failedRun)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ visualMatches: [] }] })
    vi.stubGlobal('fetch', fetchMock)
    expect(await new ApifyLensCompService('tok').findComps('https://img/ad.jpg')).toEqual({ matches: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const spent = vi.fn(async () => ({ ok: false, status: 402, text: async () => 'Monthly usage hard limit exceeded' }))
    vi.stubGlobal('fetch', spent)
    await expect(new ApifyLensCompService('tok').findComps('https://img/ad.jpg')).rejects.toThrow('Apify Lens 402')
    expect(spent).toHaveBeenCalledTimes(1)
  })

  it('gives up after two failed runs or empty datasets', async () => {
    const empty = vi.fn(async () => ({ ok: true, json: async () => [] }))
    vi.stubGlobal('fetch', empty)
    await expect(new ApifyLensCompService('tok').findComps('https://img/ad.jpg')).rejects.toThrow('no result')
    expect(empty).toHaveBeenCalledTimes(2)
  })
})
