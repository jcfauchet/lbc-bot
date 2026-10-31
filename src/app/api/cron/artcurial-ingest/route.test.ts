import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Ingest = ReturnType<typeof vi.fn<(...args: any[]) => any>>
const { HOUSES, ingest, logError } = vi.hoisted(() => {
  const houses = ['ROSSINI', 'OSENAT', 'PBA', 'GROS_DELETTREZ', 'ADER', 'ARTCURIAL'] as const
  return {
    HOUSES: houses,
    ingest: Object.fromEntries(houses.map((house) => [house, vi.fn<(...args: any[]) => any>()])) as Record<(typeof houses)[number], Ingest>,
    logError: vi.fn(),
  }
})
vi.mock('@/infrastructure/logger/logger', () => ({ logInfo: vi.fn(), logError: (...args: unknown[]) => logError(...args) }))
vi.mock('@/infrastructure/di/container', () => ({
  container: {
    auctionIngesters: Object.fromEntries(HOUSES.map((house) => [house, { ingest: (...args: unknown[]) => ingest[house](...args) }])),
  },
}))

import { CRON_HOUSE_ORDER, HOUSE_LABELS } from '@/domain/auction-houses'
import { GET } from './route'

const request = (secret?: string) =>
  new Request('http://localhost/api/cron/artcurial-ingest', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })

const report = (house: string, overrides = {}) => ({ house, salesKept: [], salesFailed: 0, lotsSeen: 0, lotsCreated: 0, lotsSkippedExisting: 0, lotsSkippedUnsold: 0, lotsFailed: 0, imagesEmbedded: 0, imagesFailed: 0, stoppedByBudget: false, ...overrides })

/** Every ingest call in the order the route made them, with its house. */
const calls = () =>
  HOUSES.flatMap((house) => ingest[house].mock.calls.map(([options], i) => ({ house, options, order: ingest[house].mock.invocationCallOrder[i] })))
    .sort((a, b) => a.order - b.order)

describe('GET /api/cron/artcurial-ingest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret'
    for (const house of HOUSES) {
      ingest[house].mockReset()
      ingest[house].mockResolvedValue(report(house))
    }
    logError.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('lists every house exactly once in the cron order', () => {
    expect([...CRON_HOUSE_ORDER].sort()).toEqual(Object.keys(HOUSE_LABELS).sort())
    expect(new Set(CRON_HOUSE_ORDER).size).toBe(CRON_HOUSE_ORDER.length)
  })

  it('rejects a missing or wrong secret with 401', async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('nope'))).status).toBe(401)
    expect(calls()).toEqual([])
  })

  it('ingests the current year for every house in the cron order, with each house concurrency', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    const made = calls()
    expect(made.map((c) => c.house)).toEqual([...CRON_HOUSE_ORDER])
    expect(made.every((c) => c.options.year === 2026 && c.options.closedBetween.minAgeDays === 2 && c.options.closedBetween.maxAgeDays === 45)).toBe(true)
    expect(made.find((c) => c.house === 'PBA')!.options.concurrency).toBe(1)
    expect(made.find((c) => c.house === 'OSENAT')!.options.concurrency).toBe(3)
    expect(made.find((c) => c.house === 'ARTCURIAL')!.options.concurrency).toBe(3)
    expect(made[0].options.maxRunMs).toBe(100_000)
  })

  it('shares one 600 s budget across every slot, each slot spending its whole share', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    for (const house of HOUSES) {
      ingest[house].mockImplementation(async (options: { maxRunMs: number }) => {
        vi.setSystemTime(Date.now() + options.maxRunMs)
        return report(house)
      })
    }
    await GET(request('secret'))
    const budgets = calls().map((c) => c.options.maxRunMs)
    expect(budgets).toHaveLength(12)
    expect(budgets[0]).toBe(50_000)
    expect(budgets.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600_000)
  })

  it('gives later houses what an early one left unused', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    await GET(request('secret'))
    const budgets = calls().map((c) => c.options.maxRunMs)
    expect(budgets.at(-1)).toBe(600_000)
  })

  it('gives the remaining slots no time once the first one overran the whole budget', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    ingest.ROSSINI.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-30T04:11:40Z'))
      return report('ROSSINI')
    })
    await GET(request('secret'))
    expect(calls().slice(1).map((c) => c.options.maxRunMs)).toEqual([0, 0, 0, 0, 0])
  })

  it('ingests the previous year first in January', async () => {
    vi.setSystemTime(new Date('2026-01-10T04:00:00Z'))
    await GET(request('secret'))
    expect(calls().map((c) => c.options.year)).toEqual([...Array(6).fill(2025), ...Array(6).fill(2026)])
  })

  it('keeps going when a house throws, logs it and still answers 200', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    ingest.OSENAT.mockRejectedValueOnce(new Error('year page 500'))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect(logError).toHaveBeenCalledWith('CRON:auction-ingest', expect.any(Error))
    const { reports } = await response.json()
    expect(reports).toHaveLength(6)
    expect(reports[1]).toEqual({ year: 2026, house: 'OSENAT', error: 'Error: year page 500' })
    expect(reports[5]).toEqual(report('ARTCURIAL'))
  })

  it('returns 200 with the reports even when lots failed', async () => {
    vi.setSystemTime(new Date('2026-10-30T04:00:00Z'))
    ingest.ROSSINI.mockResolvedValue(report('ROSSINI', { lotsFailed: 2 }))
    const response = await GET(request('secret'))
    expect(response.status).toBe(200)
    expect((await response.json()).reports[0].lotsFailed).toBe(2)
  })
})
