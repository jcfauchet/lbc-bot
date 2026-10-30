import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { IReferenceRepository, NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import { parseSalePage } from './parse-sale-page'
import { ArtcurialIngester, type IngestOptions } from './ArtcurialIngester'
import type { PageFetcher } from './ArtcurialFetcher'

const read = (f: string) => readFileSync(join(__dirname, '__fixtures__', f), 'utf8')
const lotHtml = read('lot-IT6064-278-a.html')
const saleHtml = read('sale-IT6064.html')
const sitemap = read('sitemap-2025-excerpt.xml')
const SITEMAP_URL = 'https://www.artcurial.com/sitemap/sales-2025-fr.xml'
const SALE_URL = 'https://www.artcurial.com/ventes/IT6064'
const uniqueLotUrls = [...new Set([...sitemap.matchAll(/<loc>(https:\/\/www\.artcurial\.com\/ventes\/IT6064\/lots\/\d+-[^<]+)<\/loc>/g)].map((m) => m[1]))]

const options: IngestOptions = { year: 2025, saleRef: 'IT6064', limit: 5, dryRun: false, concurrency: 2 }

function setup(opts: { fetchFail?: string; existing?: boolean; embedFailFirst?: boolean } = {}) {
  const fetched: string[] = []
  const fetcher: PageFetcher = {
    fetchText: async (url) => {
      fetched.push(url)
      if (url === opts.fetchFail) throw new Error('HTTP 404')
      if (url === SITEMAP_URL) return sitemap
      if (url === SALE_URL) return saleHtml
      if (url.includes('/lots/')) return lotHtml
      throw new Error(`unexpected ${url}`)
    },
  }
  const created: NewAuctionLot[] = []
  let n = 0
  const repo = {
    createAuctionLot: vi.fn(async (input: NewAuctionLot) => {
      if (opts.existing) return null
      created.push(input)
      const id = `ref-${n++}`
      return { id, images: input.imageUrls.slice(0, 2).map((url, i) => ({ id: `${id}-img${i}`, url })) }
    }),
    setReferenceImageEmbedding: vi.fn(async () => {}),
  } as unknown as IReferenceRepository
  let calls = 0
  const embedder: IImageEmbeddingService = {
    embedImage: vi.fn(async () => {
      if (opts.embedFailFirst && calls++ === 0) throw new Error('boom')
      return [0.1, 0.2]
    }),
  }
  const lines: string[] = []
  const ingester = new ArtcurialIngester(fetcher, repo, embedder, (l) => lines.push(l))
  return { ingester, repo, embedder, fetched, created, lines }
}

describe('ArtcurialIngester', () => {
  it('fetches the sitemap, keeps wanted sales, creates sold lots and embeds their images', async () => {
    const { ingester, repo, embedder, fetched, lines } = setup()
    const report = await ingester.ingest({ ...options, limit: undefined })
    const n = uniqueLotUrls.length
    expect(fetched[0]).toBe(SITEMAP_URL)
    expect(report.salesKept).toEqual(['IT6064'])
    expect(repo.createAuctionLot).toHaveBeenCalledTimes(n)
    expect(report.lotsSeen).toBe(n)
    expect(report.lotsCreated).toBe(n)
    expect(embedder.embedImage).toHaveBeenCalledTimes(n * 2)
    expect(repo.setReferenceImageEmbedding).toHaveBeenCalledTimes(n * 2)
    expect(report.imagesEmbedded).toBe(n * 2)
    expect(lines.some((l) => l.startsWith('kept IT6064 '))).toBe(true)
  })
  it('skips existing lots without embedding anything', async () => {
    const { ingester, embedder } = setup({ existing: true })
    const report = await ingester.ingest(options)
    expect(report.lotsSkippedExisting).toBe(5)
    expect(report.lotsCreated).toBe(0)
    expect(embedder.embedImage).not.toHaveBeenCalled()
  })
  it('counts an embedding failure and keeps going', async () => {
    const { ingester } = setup({ embedFailFirst: true })
    const report = await ingester.ingest({ ...options, concurrency: 1 })
    expect(report.imagesFailed).toBe(1)
    expect(report.lotsCreated).toBe(5)
    expect(report.imagesEmbedded).toBe(9)
  })
  it('records a failed lot page and continues', async () => {
    const { ingester } = setup({ fetchFail: uniqueLotUrls[1] })
    const report = await ingester.ingest(options)
    expect(report.lotsFailed).toBe(1)
    expect(report.lotsCreated).toBe(4)
  })
  it('dry run lists the sales and creates nothing', async () => {
    const { ingester, repo, fetched } = setup()
    const report = await ingester.ingest({ ...options, dryRun: true })
    expect(report.salesKept).toEqual(['IT6064'])
    expect(report.lotsSeen).toBe(0)
    expect(repo.createAuctionLot).not.toHaveBeenCalled()
    expect(fetched.some((u) => u.includes('/lots/'))).toBe(false)
  })
  it('--limit stops after N lots', async () => {
    const { ingester, repo } = setup()
    const report = await ingester.ingest({ ...options, limit: 3 })
    expect(report.lotsSeen).toBe(3)
    expect(repo.createAuctionLot).toHaveBeenCalledTimes(3)
  })
})

describe('ArtcurialIngester cron options', () => {
  const NOW = Date.parse('2026-10-30T04:00:00.000Z')
  const DAY = 86_400_000
  const fixtureBeginDate = parseSalePage(saleHtml)!.beginDate!
  const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
  const lotUrl = (sale: string, n: number) => `https://www.artcurial.com/ventes/${sale}/lots/${n}-a`
  const sales: Record<string, string | null> = { NEW1: iso(1), MID10: iso(10), OLD60: iso(60) }
  const year = 2026
  const multiSitemap = `<urlset>${Object.keys(sales).flatMap((s) => [1, 2].map((n) => `<url><loc>${lotUrl(s, n)}</loc></url>`)).join('')}</urlset>`

  function build(salesByRef: Record<string, string | null>, clock: () => number, onLot?: () => void) {
    const fetched: string[] = []
    const fetcher: PageFetcher = {
      fetchText: async (url) => {
        fetched.push(url)
        if (url === `https://www.artcurial.com/sitemap/sales-${year}-fr.xml`) return multiSitemap
        const saleRef = Object.keys(salesByRef).find((ref) => url === `https://www.artcurial.com/ventes/${ref}`)
        if (saleRef) {
          const date = salesByRef[saleRef]
          return date ? saleHtml.replaceAll(fixtureBeginDate, date) : saleHtml.replaceAll(`"${fixtureBeginDate}"`, 'null')
        }
        if (url.includes('/lots/')) { onLot?.(); return lotHtml }
        throw new Error(`unexpected ${url}`)
      },
    }
    const repo = {
      createAuctionLot: vi.fn(async (input: NewAuctionLot) => ({ id: 'r', images: input.imageUrls.slice(0, 1).map((url) => ({ id: 'i', url })) })),
      setReferenceImageEmbedding: vi.fn(async () => {}),
    } as unknown as IReferenceRepository
    const embedder: IImageEmbeddingService = { embedImage: vi.fn(async () => [0.1]) }
    return { ingester: new ArtcurialIngester(fetcher, repo, embedder, () => {}, clock), fetched }
  }

  it('keeps only sales closed between minAgeDays and maxAgeDays ago', async () => {
    const { ingester, fetched } = build(sales, () => NOW)
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, closedBetween: { minAgeDays: 2, maxAgeDays: 45 } })
    expect(report.salesKept).toEqual(['MID10'])
    expect(fetched.filter((u) => u.includes('/lots/'))).toEqual([lotUrl('MID10', 1), lotUrl('MID10', 2)])
  })
  it('skips sales without a date when a window is given', async () => {
    const { ingester } = build({ NEW1: null, MID10: iso(10), OLD60: iso(60) }, () => NOW)
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, closedBetween: { minAgeDays: 2, maxAgeDays: 45 } })
    expect(report.salesKept).toEqual(['MID10'])
  })
  it('keeps every wanted sale when no window is given', async () => {
    const { ingester } = build(sales, () => NOW)
    const report = await ingester.ingest({ year, dryRun: true, concurrency: 1 })
    expect(report.salesKept).toEqual(['NEW1', 'MID10', 'OLD60'])
    expect(report.stoppedByBudget).toBe(false)
  })
  it('stops starting new lots once maxRunMs is spent and says so in the report', async () => {
    let clock = NOW
    const { ingester } = build(sales, () => clock, () => { clock += 400 })
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.lotsSeen).toBe(3)
    expect(report.stoppedByBudget).toBe(true)
  })
  it('does not flag the budget when every lot was processed in time', async () => {
    const { ingester } = build(sales, () => NOW)
    const report = await ingester.ingest({ year, dryRun: false, concurrency: 1, maxRunMs: 1000 })
    expect(report.lotsSeen).toBe(6)
    expect(report.stoppedByBudget).toBe(false)
  })
})
