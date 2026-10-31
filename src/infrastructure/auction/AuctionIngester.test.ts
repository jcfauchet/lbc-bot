import { describe, expect, it, vi } from 'vitest'
import type { IReferenceRepository, NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import { AuctionIngester, type IngestOptions } from './AuctionIngester'
import type { HouseAdapter, HouseSale } from './HouseAdapter'

const NOW = Date.parse('2026-10-30T04:00:00.000Z')
const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const lotUrl = (sale: string, n: number) => `https://auction.test/ventes/${sale}/lots/${n}-a`

interface FakeSale { closedAt: string | null; finished?: boolean; lots?: number; label?: string }

/**
 * A house whose sales and lots are described in memory; every lot is sold unless listed in `unsold` or `failing`.
 * Sales are yielded lazily, like a house that fetches one sale page per sale; `yieldedSales` records them.
 */
function fakeAdapter(salesByRef: Record<string, FakeSale>, opts: {
  unsold?: string[]
  failing?: string[]
  unreadableSales?: string[]
  onYieldSale?: () => void
  onListLots?: () => void
  onFetchLot?: () => void
} = {}) {
  const fetchedLots: string[] = []
  const yieldedSales: string[] = []
  // totalLots stays 0, like a house that only learns the lot count from the catalogue.
  const sales: HouseSale[] = Object.entries(salesByRef).map(([ref, s]) => ({
    ref, name: `Sale ${ref}`, closedAt: s.closedAt, finished: s.finished ?? true, totalLots: 0,
    ...(s.label === undefined ? {} : { label: s.label }),
  }))
  const adapter: HouseAdapter = {
    house: 'ARTCURIAL',
    listSales: vi.fn((_year: number, filter: { saleRef?: string }) => (async function* () {
      for (const sale of sales) {
        if (filter.saleRef && sale.ref !== filter.saleRef) continue
        opts.onYieldSale?.()
        yieldedSales.push(sale.ref)
        yield sale
      }
    })()),
    listLotUrls: vi.fn(async (sale: HouseSale) => {
      opts.onListLots?.()
      if (opts.unreadableSales?.includes(sale.ref)) throw new Error('catalogue total not found')
      return Array.from({ length: salesByRef[sale.ref].lots ?? 2 }, (_, i) => lotUrl(sale.ref, i + 1))
    }),
    lotRefFromUrl: (url) => url.slice(url.lastIndexOf('/') + 1),
    fetchLot: vi.fn(async (url: string, sale: HouseSale): Promise<NewAuctionLot | null> => {
      fetchedLots.push(url)
      opts.onFetchLot?.()
      if (opts.failing?.includes(url)) throw new Error('HTTP 404')
      if (opts.unsold?.includes(url)) return null
      return {
        name: url, note: '', keywords: [], imageUrls: [`${url}/1.jpg`, `${url}/2.jpg`, `${url}/3.jpg`],
        lot: {
          house: 'ARTCURIAL', saleRef: sale.ref, lotRef: url.slice(url.lastIndexOf('/') + 1), lotUrl: url, saleName: sale.name,
          soldAt: new Date(NOW), title: url, artist: null, hammerCents: 100, quantity: 1, hammerPerUnitCents: 100,
          artistYears: null, description: '', estimateLowCents: null, estimateHighCents: null, finalCents: null,
        },
      }
    }),
  }
  return { adapter, fetchedLots, yieldedSales }
}

function setup(salesByRef: Record<string, FakeSale>, opts: {
  existing?: boolean
  embedFailFirst?: boolean
  knownLotRefs?: string[]
  unsold?: string[]
  failing?: string[]
  unreadableSales?: string[]
  clock?: () => number
  onYieldSale?: () => void
  onListLots?: () => void
  onFetchLot?: () => void
} = {}) {
  const { adapter, fetchedLots, yieldedSales } = fakeAdapter(salesByRef, opts)
  let n = 0
  const repo = {
    createAuctionLot: vi.fn(async (input: NewAuctionLot) => {
      if (opts.existing) return null
      const id = `ref-${n++}`
      return { id, images: input.imageUrls.slice(0, 2).map((url, i) => ({ id: `${id}-img${i}`, url })) }
    }),
    setReferenceImageEmbedding: vi.fn(async () => {}),
    findExistingLotRefs: vi.fn(async () => new Set<string>(opts.knownLotRefs ?? [])),
  } as unknown as IReferenceRepository
  let calls = 0
  const embedder: IImageEmbeddingService = {
    embedImage: vi.fn(async () => {
      if (opts.embedFailFirst && calls++ === 0) throw new Error('boom')
      return [0.1, 0.2]
    }),
  }
  const lines: string[] = []
  const ingester = new AuctionIngester(adapter, repo, embedder, (l) => lines.push(l), opts.clock ?? (() => NOW))
  return { ingester, adapter, repo, embedder, fetchedLots, yieldedSales, lines }
}

const ONE_SALE = { IT6064: { closedAt: iso(200), lots: 8, label: 'DESIGN,ART_DECO' }, OTHER: { closedAt: iso(200), lots: 3 } }
const options: IngestOptions = { year: 2025, saleRef: 'IT6064', limit: 5, dryRun: false, concurrency: 2 }

describe('AuctionIngester', () => {
  it('lists the sales once, keeps the wanted sale, creates sold lots and embeds their images', async () => {
    const { ingester, adapter, repo, embedder, yieldedSales, lines } = setup(ONE_SALE)
    const report = await ingester.ingest({ ...options, limit: undefined })
    expect(adapter.listSales).toHaveBeenCalledTimes(1)
    expect(adapter.listSales).toHaveBeenCalledWith(2025, { saleRef: 'IT6064' })
    expect(yieldedSales).toEqual(['IT6064'])
    expect(report.house).toBe('ARTCURIAL')
    expect(report.salesKept).toEqual(['IT6064'])
    expect(repo.createAuctionLot).toHaveBeenCalledTimes(8)
    expect(report.lotsSeen).toBe(8)
    expect(report.lotsCreated).toBe(8)
    expect(embedder.embedImage).toHaveBeenCalledTimes(16)
    expect(repo.setReferenceImageEmbedding).toHaveBeenCalledTimes(16)
    expect(report.imagesEmbedded).toBe(16)
    expect(lines).toContain('kept IT6064 Sale IT6064 8 lots DESIGN,ART_DECO')
  })
  it('asks the house for every sale when no sale is given and logs a sale without a label', async () => {
    const { ingester, adapter, yieldedSales, lines } = setup(ONE_SALE)
    const report = await ingester.ingest({ ...options, saleRef: undefined, dryRun: true })
    expect(adapter.listSales).toHaveBeenCalledWith(2025, { saleRef: undefined })
    expect(yieldedSales).toEqual(['IT6064', 'OTHER'])
    expect(report.salesKept).toEqual(['IT6064', 'OTHER'])
    expect(lines).toContain('kept OTHER Sale OTHER 3 lots ')
  })
  it('skips existing lots without embedding anything', async () => {
    const { ingester, embedder } = setup(ONE_SALE, { existing: true })
    const report = await ingester.ingest(options)
    expect(report.lotsSkippedExisting).toBe(5)
    expect(report.lotsCreated).toBe(0)
    expect(embedder.embedImage).not.toHaveBeenCalled()
  })
  it('counts an embedding failure and keeps going', async () => {
    const { ingester } = setup(ONE_SALE, { embedFailFirst: true })
    const report = await ingester.ingest({ ...options, concurrency: 1 })
    expect(report.imagesFailed).toBe(1)
    expect(report.lotsCreated).toBe(5)
    expect(report.imagesEmbedded).toBe(9)
  })
  it('records a failed lot page and continues', async () => {
    const { ingester, lines } = setup(ONE_SALE, { failing: [lotUrl('IT6064', 2)] })
    const report = await ingester.ingest(options)
    expect(report.lotsFailed).toBe(1)
    expect(report.lotsCreated).toBe(4)
    expect(lines).toContain(`lot failed ${lotUrl('IT6064', 2)}: HTTP 404`)
  })
  it('counts a lot the house did not sell as unsold', async () => {
    const { ingester, repo } = setup(ONE_SALE, { unsold: [lotUrl('IT6064', 3)] })
    const report = await ingester.ingest(options)
    expect(report.lotsSkippedUnsold).toBe(1)
    expect(report.lotsFailed).toBe(0)
    expect(report.lotsCreated).toBe(4)
    expect(repo.createAuctionLot).toHaveBeenCalledTimes(4)
  })
  it('skips lots already stored without fetching their page', async () => {
    const { ingester, repo, fetchedLots } = setup(ONE_SALE, { knownLotRefs: ['1-a'] })
    const report = await ingester.ingest({ ...options, limit: undefined })
    expect(repo.findExistingLotRefs).toHaveBeenCalledWith('ARTCURIAL', 'IT6064')
    expect(fetchedLots).not.toContain(lotUrl('IT6064', 1))
    expect(report.lotsSkippedExisting).toBe(1)
    expect(report.lotsSeen).toBe(7)
  })
  it('dry run lists the sales and creates nothing', async () => {
    const { ingester, repo, fetchedLots } = setup(ONE_SALE)
    const report = await ingester.ingest({ ...options, dryRun: true })
    expect(report.salesKept).toEqual(['IT6064'])
    expect(report.lotsSeen).toBe(0)
    expect(repo.createAuctionLot).not.toHaveBeenCalled()
    expect(repo.findExistingLotRefs).not.toHaveBeenCalled()
    expect(fetchedLots).toEqual([])
  })
  it('--limit stops after N lots', async () => {
    const { ingester, repo } = setup(ONE_SALE)
    const report = await ingester.ingest({ ...options, limit: 3 })
    expect(report.lotsSeen).toBe(3)
    expect(repo.createAuctionLot).toHaveBeenCalledTimes(3)
  })
  it('skips a sale whose catalogue cannot be read, counts it as failed and goes on', async () => {
    const { ingester, lines, fetchedLots } = setup(ONE_SALE, { unreadableSales: ['IT6064'] })
    const report = await ingester.ingest({ ...options, saleRef: undefined, limit: undefined })
    expect(report.salesKept).toEqual(['OTHER'])
    expect(report.salesFailed).toBe(1)
    expect(lines).toContain('sale IT6064 skipped: catalogue total not found')
    expect(lines.some((l) => l.startsWith('kept IT6064'))).toBe(false)
    expect(fetchedLots).toEqual([lotUrl('OTHER', 1), lotUrl('OTHER', 2), lotUrl('OTHER', 3)])
  })
  it('logs progress every 25 lots', async () => {
    const { ingester, lines } = setup({ BIG: { closedAt: iso(200), lots: 30 } })
    await ingester.ingest({ year: 2025, dryRun: false, concurrency: 1 })
    expect(lines.filter((l) => l.startsWith('progress '))).toEqual(['progress 25/30 lots'])
  })
})

describe('AuctionIngester cron options', () => {
  const sales: Record<string, FakeSale> = { NEW1: { closedAt: iso(1) }, MID10: { closedAt: iso(10) }, OLD60: { closedAt: iso(60) } }
  const year = 2026

  it('keeps only sales closed between minAgeDays and maxAgeDays ago', async () => {
    const { ingester, fetchedLots } = setup(sales)
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, closedBetween: { minAgeDays: 2, maxAgeDays: 45 } })
    expect(report.salesKept).toEqual(['MID10'])
    expect(fetchedLots).toEqual([lotUrl('MID10', 1), lotUrl('MID10', 2)])
  })
  it('skips sales without a date when a window is given', async () => {
    const { ingester } = setup({ NEW1: { closedAt: null }, MID10: { closedAt: iso(10) }, OLD60: { closedAt: iso(60) } })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, closedBetween: { minAgeDays: 2, maxAgeDays: 45 } })
    expect(report.salesKept).toEqual(['MID10'])
  })
  it('judges the window on the closing date and skips sales still open or not finished', async () => {
    const { ingester, fetchedLots } = setup({
      OPEN: { closedAt: iso(-3) },
      LIVE: { closedAt: iso(10), finished: false },
      DONE: { closedAt: iso(10) },
    })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, closedBetween: { minAgeDays: 2, maxAgeDays: 45 } })
    expect(report.salesKept).toEqual(['DONE'])
    expect(fetchedLots).toEqual([lotUrl('DONE', 1), lotUrl('DONE', 2)])
  })
  it('keeps every wanted sale when no window is given', async () => {
    const { ingester } = setup(sales)
    const report = await ingester.ingest({ year, dryRun: true, concurrency: 1 })
    expect(report.salesKept).toEqual(['NEW1', 'MID10', 'OLD60'])
    expect(report.salesFailed).toBe(0)
    expect(report.stoppedByBudget).toBe(false)
  })
  it('stops starting new lots once maxRunMs is spent and says so in the report', async () => {
    let clock = NOW
    const { ingester } = setup(sales, { clock: () => clock, onFetchLot: () => { clock += 400 } })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.lotsSeen).toBe(3)
    expect(report.stoppedByBudget).toBe(true)
  })
  it('stops scanning sales when the budget is spent during the sale scan', async () => {
    let clock = NOW
    const { ingester, fetchedLots } = setup(sales, { clock: () => clock, onListLots: () => { clock += 600 } })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.stoppedByBudget).toBe(true)
    expect(report.lotsSeen).toBe(0)
    expect(fetchedLots).toEqual([])
  })
  it('stops asking for sales once the budget is spent on slow sale pages', async () => {
    let clock = NOW
    const { ingester, yieldedSales, fetchedLots } = setup(sales, { clock: () => clock, onYieldSale: () => { clock += 600 } })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.stoppedByBudget).toBe(true)
    expect(yieldedSales).toEqual(['NEW1', 'MID10'])
    expect(report.salesKept).toEqual(['NEW1', 'MID10'])
    expect(report.lotsSeen).toBe(0)
    expect(fetchedLots).toEqual([])
  })
  it('does not flag the budget when every lot was processed in time', async () => {
    const { ingester } = setup(sales)
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.lotsSeen).toBe(6)
    expect(report.stoppedByBudget).toBe(false)
  })
})
