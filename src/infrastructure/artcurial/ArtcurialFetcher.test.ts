import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtcurialFetcher, ClientError, timeoutMsFor } from './ArtcurialFetcher'

describe('timeoutMsFor', () => {
  it('gives a yearly sitemap a long timeout', () => {
    expect(timeoutMsFor('https://www.artcurial.com/sitemap/sales-2025-fr.xml')).toBe(90_000)
  })
  it('keeps the short timeout for sale and lot pages', () => {
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064')).toBe(15_000)
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064/lots/278-a')).toBe(15_000)
  })
})

describe('ArtcurialFetcher', () => {
  const URL = 'https://www.pba-auctions.com/resultats?year=2025'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubResponses(...statuses: number[]) {
    const fetchMock = vi.fn()
    for (const status of statuses) fetchMock.mockResolvedValueOnce(new Response(`body ${status}`, { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('waits 5 s and retries once after a 429', async () => {
    const fetchMock = stubResponses(429, 200)
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await new ArtcurialFetcher(sleep).fetchText(URL)).toBe('body 200')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(5_000)
  })

  it('throws a non-client error when the retry is still a 429', async () => {
    const fetchMock = stubResponses(429, 429)
    const sleep = vi.fn(async (_ms: number) => {})
    const error = await new ArtcurialFetcher(sleep).fetchText(URL).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ClientError)
    expect((error as Error).message).toMatch(/HTTP 429/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('throws a client error on another 4xx without retrying', async () => {
    const fetchMock = stubResponses(404)
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(new ArtcurialFetcher(sleep).fetchText(URL)).rejects.toBeInstanceOf(ClientError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a 5xx once without waiting', async () => {
    const fetchMock = stubResponses(503, 200)
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await new ArtcurialFetcher(sleep).fetchText(URL)).toBe('body 200')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).not.toHaveBeenCalled()
  })
})
