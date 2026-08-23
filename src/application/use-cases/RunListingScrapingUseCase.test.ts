import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RunListingScrapingUseCase } from './RunListingScrapingUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ScrapedListing } from '@/infrastructure/scraping/types'
import { DataDomeBlockedError } from '@/domain/services/IListingSource'

const ad = (lbcId: string, imageUrls: string[] = []): ScrapedListing => ({
  lbcId,
  url: `https://lbc/${lbcId}`,
  title: `ad-${lbcId}`,
  priceCents: 8000,
  imageUrls,
})

const deps = (scraped: ScrapedListing[], knownLbcIds: string[] = [], searchCount = 1) => {
  const savedImages: Array<{ listingId: string; urlRemote: string }> = []
  return {
    savedImages,
    searchRepository: {
      findActive: vi.fn(async () =>
        Array.from({ length: searchCount }, (_, i) => ({
          id: `search-${i + 1}`,
          name: `search-${i + 1}`,
          url: 'u',
        })) as any
      ),
      markScraped: vi.fn(async () => {}),
    } as any,
    listingRepository: {
      findExistingLbcIds: vi.fn(async () => new Set(knownLbcIds)),
      // Stands in for createManyAndReturn: ids are assigned on insert.
      saveMany: vi.fn(async (listings: Listing[]) =>
        listings.map((l) =>
          Listing.fromPersistence({
            ...(l as any).props,
            id: `id-${l.lbcId}`,
          })
        )
      ),
    } as any,
    imageRepository: {
      saveMany: vi.fn(async (images: any[]) => {
        savedImages.push(
          ...images.map((i) => ({ listingId: i.listingId, urlRemote: i.urlRemote }))
        )
      }),
    } as any,
    listingSourceApi: { search: vi.fn(async () => scraped) } as any,
    listingSourceScraper: { search: vi.fn(async () => []) } as any,
  }
}

// The use case sleeps 5-13s between searches to stay under DataDome's radar.
// Fake timers keep the suite instant without weakening what is asserted.
const run = async (
  d: ReturnType<typeof deps>,
  maxRunMillis?: number,
  maxSearchesPerRun = 100
) => {
  const useCase = new RunListingScrapingUseCase(
    d.searchRepository,
    d.listingRepository,
    d.imageRepository,
    d.listingSourceApi,
    d.listingSourceScraper,
    maxSearchesPerRun,
    maxRunMillis
  )
  const executing = useCase.execute()
  await vi.runAllTimersAsync()
  return executing
}

describe('RunListingScrapingUseCase', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('inserts a whole page in one batch instead of one round trip per ad', async () => {
    const d = deps([ad('a'), ad('b'), ad('c')])

    const result = await run(d)

    expect(d.listingRepository.findExistingLbcIds).toHaveBeenCalledTimes(1)
    expect(d.listingRepository.saveMany).toHaveBeenCalledTimes(1)
    expect(result.newListings).toBe(3)
  })

  it('skips ads already stored and counts them as updated', async () => {
    const d = deps([ad('a'), ad('b')], ['a'])

    const result = await run(d)

    expect(d.listingRepository.saveMany.mock.calls[0][0].map((l: Listing) => l.lbcId)).toEqual(['b'])
    expect(result.newListings).toBe(1)
    expect(result.updatedListings).toBe(1)
  })

  it('de-duplicates an ad returned twice on the same page', async () => {
    // A batch insert of both copies would violate the lbcId unique constraint
    // and lose the entire page, not just the duplicate.
    const d = deps([ad('a'), ad('a'), ad('b')])

    const result = await run(d)

    expect(d.listingRepository.saveMany.mock.calls[0][0].map((l: Listing) => l.lbcId)).toEqual(['a', 'b'])
    expect(result.newListings).toBe(2)
  })

  it('attaches each image to the listing it was scraped with', async () => {
    const d = deps([ad('a', ['a1.jpg', 'a2.jpg']), ad('b', ['b1.jpg'])])

    await run(d)

    expect(d.imageRepository.saveMany).toHaveBeenCalledTimes(1)
    expect(d.savedImages).toEqual([
      { listingId: 'id-a', urlRemote: 'a1.jpg' },
      { listingId: 'id-a', urlRemote: 'a2.jpg' },
      { listingId: 'id-b', urlRemote: 'b1.jpg' },
    ])
  })

  it('defers the remaining searches once the run budget is spent', async () => {
    // Without this the function was killed at the serverless ceiling: a 504,
    // and the search it died on never got its lastScrapedAt stamped.
    const d = deps([], [], 3)

    const result = await run(d, 1)

    expect(result.searchesScraped).toBe(1)
    expect(result.searchesDeferred).toBe(2)
    expect(d.searchRepository.markScraped).toHaveBeenCalledTimes(1)
  })

  it('scrapes every search when the budget is generous', async () => {
    const d = deps([], [], 3)

    const result = await run(d, 600_000)

    expect(result.searchesScraped).toBe(3)
    expect(result.searchesDeferred).toBe(0)
  })

  it('attempts at most maxSearchesPerRun and defers the rest', async () => {
    // DataDome refuses the tenth request of a session, so a run that tries
    // every search spends its tail being blocked instead of scraping.
    const d = deps([], [], 13)

    const result = await run(d, 600_000, 6)

    expect(result.searchesScraped).toBe(6)
    expect(result.totalSearches).toBe(13)
    expect(result.searchesDeferred).toBe(7)
    expect(d.listingSourceApi.search).toHaveBeenCalledTimes(6)
  })

  it('takes the least recently scraped searches first', async () => {
    // findActive already orders by lastScrapedAt, so the slice must preserve
    // that order for the rotation to stay fair across runs.
    const d = deps([], [], 13)

    await run(d, 600_000, 3)

    expect(d.searchRepository.markScraped.mock.calls.map((c: any[]) => c[0]))
      .toEqual(['search-1', 'search-2', 'search-3'])
  })

  it('does not fall back to the browser when DataDome refused the API', async () => {
    // The scraper walks into the same refusal, after a chromium launch and a
    // screenshot upload.
    const d = deps([])
    d.listingSourceApi.search = vi.fn(async () => {
      throw new DataDomeBlockedError()
    })

    const result = await run(d)

    expect(d.listingSourceScraper.search).not.toHaveBeenCalled()
    expect(d.searchRepository.markScraped).toHaveBeenCalledWith('search-1')
    expect(result.newListings).toBe(0)
  })

  it('still falls back to the browser for any other API failure', async () => {
    const d = deps([])
    d.listingSourceApi.search = vi.fn(async () => {
      throw new Error('socket hang up')
    })

    await run(d)

    expect(d.listingSourceScraper.search).toHaveBeenCalledTimes(1)
  })

  it('marks the search scraped even when the source throws', async () => {
    const d = deps([])
    d.listingSourceApi.search = vi.fn(async () => {
      throw new Error('DataDome')
    })
    d.listingSourceScraper.search = vi.fn(async () => {
      throw new Error('DataDome')
    })

    const result = await run(d)

    expect(d.searchRepository.markScraped).toHaveBeenCalledWith('search-1')
    expect(result.newListings).toBe(0)
  })
})
