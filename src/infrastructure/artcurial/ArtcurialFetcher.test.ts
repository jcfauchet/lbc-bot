import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtcurialFetcher, ClientError, minIntervalMsFor, timeoutMsFor } from './ArtcurialFetcher'

describe('timeoutMsFor', () => {
  it('gives a yearly sitemap a long timeout', () => {
    expect(timeoutMsFor('https://www.artcurial.com/sitemap/sales-2025-fr.xml')).toBe(90_000)
  })
  it('keeps the short timeout for sale and lot pages', () => {
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064')).toBe(15_000)
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064/lots/278-a')).toBe(15_000)
  })
})

describe('minIntervalMsFor', () => {
  it('spaces requests to the Drouot-platform sites and Ader by one second', () => {
    expect(minIntervalMsFor('https://www.osenat.com/lot/1/2')).toBe(1_000)
    expect(minIntervalMsFor('https://ader-paris.fr/l/3')).toBe(1_000)
  })
  it('leaves Artcurial unthrottled', () => {
    expect(minIntervalMsFor('https://www.artcurial.com/ventes/IT6064')).toBe(0)
  })
})

describe('ArtcurialFetcher', () => {
  const URL = 'https://www.pba-auctions.com/resultats?year=2025'
  const ARTCURIAL_URL = 'https://www.artcurial.com/ventes/IT6064'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubResponses(...responses: Array<number | Response>) {
    const fetchMock = vi.fn()
    for (const r of responses) fetchMock.mockResolvedValueOnce(typeof r === 'number' ? new Response(`body ${r}`, { status: r }) : r)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  /** A fake clock that the fake sleep advances, so the throttle sees time pass. */
  function fakeTime() {
    let t = 1_000_000
    const sleep = vi.fn(async (ms: number) => { t += ms })
    return { sleep, now: () => t }
  }

  it('waits 30 s and retries after a 429 without Retry-After', async () => {
    const fetchMock = stubResponses(429, 200)
    const { sleep, now } = fakeTime()
    expect(await new ArtcurialFetcher(sleep, now).fetchText(URL)).toBe('body 200')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(30_000)
  })

  it('honours Retry-After on a 429', async () => {
    stubResponses(new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }), 200)
    const { sleep, now } = fakeTime()
    expect(await new ArtcurialFetcher(sleep, now).fetchText(URL)).toBe('body 200')
    expect(sleep).toHaveBeenCalledWith(7_000)
  })

  it('retries a 429 twice, then throws a non-client error', async () => {
    const fetchMock = stubResponses(429, 429, 429)
    const { sleep, now } = fakeTime()
    const error = await new ArtcurialFetcher(sleep, now).fetchText(URL).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ClientError)
    expect((error as Error).message).toMatch(/HTTP 429/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws a client error on another 4xx without retrying', async () => {
    const fetchMock = stubResponses(404)
    const { sleep, now } = fakeTime()
    await expect(new ArtcurialFetcher(sleep, now).fetchText(URL)).rejects.toBeInstanceOf(ClientError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a 5xx once without waiting beyond the throttle', async () => {
    const fetchMock = stubResponses(503, 200)
    const { sleep, now } = fakeTime()
    expect(await new ArtcurialFetcher(sleep, now).fetchText(URL)).toBe('body 200')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The retry waits for the host's next one-second slot.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000])
  })

  it('spaces concurrent requests to one host by one second', async () => {
    stubResponses(200, 200, 200)
    const t = 1_000_000
    const sleep = vi.fn(async (_ms: number) => {})
    const fetcher = new ArtcurialFetcher(sleep, () => t)
    await Promise.all([fetcher.fetchText(URL), fetcher.fetchText(URL), fetcher.fetchText(URL)])
    expect(sleep.mock.calls.map(([ms]) => ms).sort((a, b) => a - b)).toEqual([1_000, 2_000])
  })

  it('does not throttle Artcurial', async () => {
    stubResponses(200, 200)
    const t = 1_000_000
    const sleep = vi.fn(async (_ms: number) => {})
    const fetcher = new ArtcurialFetcher(sleep, () => t)
    await Promise.all([fetcher.fetchText(ARTCURIAL_URL), fetcher.fetchText(ARTCURIAL_URL)])
    expect(sleep).not.toHaveBeenCalled()
  })
})
