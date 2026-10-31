import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const artcurialIngest = vi.fn()
const rossiniIngest = vi.fn()
const logError = vi.fn()
vi.mock('@/infrastructure/logger/logger', () => ({ logInfo: vi.fn(), logError: (...args: unknown[]) => logError(...args) }))
vi.mock('@/infrastructure/di/container', () => ({
  container: {
    auctionIngesters: {
      ARTCURIAL: { ingest: (...args: unknown[]) => artcurialIngest(...args) },
      ROSSINI: { ingest: (...args: unknown[]) => rossiniIngest(...args) },
    },
  },
}))

import { GET } from './route'

const request = (secret?: string) =>
  new Request('http://localhost/api/cron/artcurial-ingest', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })

const report = (house: string, overrides = {}) => ({ house, salesKept: [], lotsSeen: 0, lotsCreated: 0, lotsSkippedExisting: 0, lotsSkippedUnsold: 0, lotsFailed: 0, imagesEmbedded: 0, imagesFailed: 0, stoppedByBudget: false, ...overrides })

const window = { closedBetween: { minAgeDays: 2, maxAgeDays: 45 }, dryRun: false, concurrency: 3 }

describe('GET /api/cron/artcurial-ingest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret'
    artcurialIngest.mockReset()
    artcurialIngest.mockResolvedValue(report('ARTCURIAL'))
    rossiniIngest.mockReset()
    rossiniIngest.mockResolvedValue(report('ROSSINI'))
    logError.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects a missing or wrong secret with 401', async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('nope'))).status).toBe(401)
    expect(artcurialIngest).not.toHaveBeenCalled()
    expect(rossiniIngest).not.toHaveBeenCalled()
  })

  it('ingests the current year for both houses, Artcurial first, splitting the time budget', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    const order: string[] = []
    artcurialIngest.mockImplementation(async () => { order.push('ARTCURIAL'); return report('ARTCURIAL') })
    rossiniIngest.mockImplementation(async () => { order.push('ROSSINI'); return report('ROSSINI') })
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect(order).toEqual(['ARTCURIAL', 'ROSSINI'])
    expect(artcurialIngest).toHaveBeenCalledWith({ year: 2026, ...window, maxRunMs: 300_000 })
    expect(rossiniIngest).toHaveBeenCalledWith({ year: 2026, ...window, maxRunMs: 600_000 })
    expect(await response.json()).toEqual({ reports: [report('ARTCURIAL'), report('ROSSINI')] })
  })

  it('gives Rossini what Artcurial left unused, the budgets summing to 600 s', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    artcurialIngest.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-10-30T04:01:40Z'))
      return report('ARTCURIAL')
    })
    await GET(request('secret'))
    const artcurialBudget = artcurialIngest.mock.calls[0][0].maxRunMs
    const rossiniBudget = rossiniIngest.mock.calls[0][0].maxRunMs
    expect(artcurialBudget).toBe(300_000)
    expect(rossiniBudget).toBe(500_000)
    expect(100_000 + rossiniBudget).toBe(600_000)
  })

  it('ingests the previous year first in January, both houses each year', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    const response = await GET(request('secret'))
    expect(artcurialIngest.mock.calls.map(([o]) => o.year)).toEqual([2025, 2026])
    expect(rossiniIngest.mock.calls.map(([o]) => o.year)).toEqual([2025, 2026])
    expect((await response.json()).reports.map((r: { house: string }) => r.house)).toEqual(['ARTCURIAL', 'ROSSINI', 'ARTCURIAL', 'ROSSINI'])
  })

  it('keeps going when a house throws, logs it and still answers 200', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    artcurialIngest.mockRejectedValueOnce(new Error('sitemap 404'))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect(rossiniIngest).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith('CRON:artcurial-ingest', expect.any(Error))
    expect(await response.json()).toEqual({ reports: [{ year: 2026, house: 'ARTCURIAL', error: 'Error: sitemap 404' }, report('ROSSINI')] })
  })

  it('keeps Artcurial running when Rossini throws', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    rossiniIngest.mockRejectedValueOnce(new Error('year page 500'))
    const response = await GET(request('secret'))
    expect(artcurialIngest).toHaveBeenCalledTimes(2)
    expect(rossiniIngest).toHaveBeenCalledTimes(2)
    expect(await response.json()).toEqual({
      reports: [report('ARTCURIAL'), { year: 2025, house: 'ROSSINI', error: 'Error: year page 500' }, report('ARTCURIAL'), report('ROSSINI')],
    })
  })

  it('returns 200 with the reports even when lots failed', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    artcurialIngest.mockResolvedValue(report('ARTCURIAL', { lotsFailed: 2 }))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect((await response.json()).reports[0].lotsFailed).toBe(2)
  })
})
