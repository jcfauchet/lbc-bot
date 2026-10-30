import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ingest = vi.fn()
const logError = vi.fn()
vi.mock('@/infrastructure/logger/logger', () => ({ logInfo: vi.fn(), logError: (...args: unknown[]) => logError(...args) }))
vi.mock('@/infrastructure/di/container', () => ({ container: { artcurialIngester: { ingest: (...args: unknown[]) => ingest(...args) } } }))

import { GET } from './route'

const request = (secret?: string) =>
  new Request('http://localhost/api/cron/artcurial-ingest', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })

const report = (overrides = {}) => ({ salesKept: [], lotsSeen: 0, lotsCreated: 0, lotsSkippedExisting: 0, lotsSkippedUnsold: 0, lotsFailed: 0, imagesEmbedded: 0, imagesFailed: 0, stoppedByBudget: false, ...overrides })

describe('GET /api/cron/artcurial-ingest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret'
    ingest.mockReset()
    ingest.mockResolvedValue(report())
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
    expect(ingest).not.toHaveBeenCalled()
  })

  it('ingests the current year with the date window and time budget', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest).toHaveBeenCalledWith({ year: 2026, closedBetween: { minAgeDays: 2, maxAgeDays: 45 }, maxRunMs: 600_000, dryRun: false, concurrency: 3 })
    expect(await response.json()).toEqual({ reports: [report()] })
  })

  it('ingests the previous year first in January', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    await GET(request('secret'))
    expect(ingest.mock.calls.map(([o]) => o.year)).toEqual([2025, 2026])
  })

  it('keeps going when a year throws, logs it and still answers 200', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    ingest.mockRejectedValueOnce(new Error('sitemap 404'))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect(ingest).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledWith('CRON:artcurial-ingest', expect.any(Error))
    expect(await response.json()).toEqual({ reports: [{ year: 2025, error: 'Error: sitemap 404' }, report()] })
  })

  it('returns 200 with the reports even when lots failed', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    ingest.mockResolvedValue(report({ lotsFailed: 2 }))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect((await response.json()).reports[0].lotsFailed).toBe(2)
  })
})
