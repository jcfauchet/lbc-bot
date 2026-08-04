import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RunCompAnalysisUseCase, windowEntitlement, currentWindowKey } from './RunCompAnalysisUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mk = (id: string, score: number, euros = 80, opts: { title?: string; description?: string; createdAt?: Date } = {}) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: opts.title ?? id, description: opts.description, price: Money.fromEuros(euros), status: ListingStatus.TRIAGED })
  ;(l as any).props = { ...(l as any).props, id, triageScore: score, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) }
  return l
}

const deps = (overrides: any = {}) => {
  const saved: any[] = []
  const statuses: Record<string, ListingStatus> = {}
  return {
    saved, statuses,
    listingRepository: {
      findByStatus: vi.fn(async () => overrides.listings ?? []),
      update: vi.fn(async (l: Listing) => { statuses[l.id] = l.status; return l }),
    } as any,
    aiAnalysisRepository: { save: vi.fn(async (a: any) => { saved.push(a); return a }) } as any,
    imageRepository: { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any,
    compService: { providerName: 'serpapi', findComps: vi.fn(async () => overrides.comps ?? { matches: [] }) } as any,
    budgetRepository: {
      countSince: vi.fn(async () => 0),
      recordCall: vi.fn(async () => {}),
    } as any,
  }
}

const ranker = (picks: any) => ({
  providerName: 'gemini',
  rank: vi.fn(async (_candidates: any[], _guidance?: any) => {
    if (picks instanceof Error) throw picks
    return picks
  }),
})

describe('RunCompAnalysisUseCase', () => {
  it('analyzes the highest-scored listing and saves an AiAnalysis', async () => {
    const d = deps({
      listings: [mk('low', 6), mk('high', 9)],
      comps: { matches: [
        { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
        { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
        { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
      ] },
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).toHaveBeenCalledTimes(2)
    expect(d.saved).toHaveLength(2)
    expect(d.statuses['high']).toBe(ListingStatus.ANALYZED)
    // Interquartile band of [1000, 2000, 3000], not the raw min/max.
    expect(d.saved[0].estimatedMinPrice.getEuros()).toBe(1500)
    expect(d.saved[0].estimatedMaxPrice.getEuros()).toBe(2500)
    expect(res.analyzed).toBe(2)
  })

  it('discounts the estimate and margin by the resale realization factor', async () => {
    const d = deps({
      listings: [mk('x', 9, 100)],
      comps: { matches: [
        { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
        { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
        { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
      ] },
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 0.6 },
    )
    await useCase.execute()

    // Raw interquartile band is 1500-2500 (median 2000); resale realization
    // factor 0.6 brings it down to realistic resale figures.
    expect(d.saved[0].estimatedMinPrice.getEuros()).toBe(900)
    expect(d.saved[0].estimatedMaxPrice.getEuros()).toBe(1500)
    // Margin is realistic resale median (2000*0.6=1200) minus buy price (100).
    expect(d.saved[0].margin.getEuros()).toBe(1100)
  })

  it('skips a listing the seller describes as a look-alike without spending a comp credit', async () => {
    const d = deps({
      listings: [mk('replica', 9, 500, { title: 'Table dans le style de Willy Rizzo', description: 'Belle table, ressemble à du Willy Rizzo' })],
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(d.budgetRepository.recordCall).not.toHaveBeenCalled()
    expect(d.statuses['replica']).toBe(ListingStatus.IGNORED)
    expect(d.saved).toHaveLength(0)
    expect(res.analyzed).toBe(0)
    expect(res.ignored).toBe(1)
  })

  it('stops at the remaining daily budget', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 8), mk('c', 7)] })
    d.budgetRepository.countSince = vi.fn(async () => 7)
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    const res = await useCase.execute()
    expect(d.compService.findComps).toHaveBeenCalledTimes(1)
    expect(res.processed).toBe(1)
  })

  it('skips a listing that already names a known designer without spending a comp credit', async () => {
    const d = deps({
      listings: [mk('named', 9, 290, { title: 'Table Cone Verner Panton - Édition Vitra Vintage' })],
    })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(d.statuses['named']).toBe(ListingStatus.IGNORED)
    expect(d.saved).toHaveLength(0)
    expect(res.ignored).toBe(1)
  })

  it('expires stale triaged listings before picking candidates', async () => {
    const d = deps({ listings: [] })
    d.listingRepository.ignoreTriagedOlderThan = vi.fn(async () => 42)
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, triagedMaxAgeDays: 7 },
    )
    const res = await useCase.execute()

    expect(d.listingRepository.ignoreTriagedOlderThan).toHaveBeenCalledWith(7, expect.any(String))
    expect(res.expired).toBe(42)
  })

  it('breaks score ties by freshness so credits go to listings whose deal is still alive', async () => {
    const stale = mk('stale', 9, 80, { createdAt: new Date('2026-06-20T10:00:00Z') })
    const fresh = mk('fresh', 9, 80, { createdAt: new Date('2026-07-03T10:00:00Z') })
    const d = deps({ listings: [stale, fresh], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    d.budgetRepository.countSince = vi.fn(async () => 7) // 1 credit left
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    await useCase.execute()

    expect(d.statuses['fresh']).toBe(ListingStatus.ANALYZED)
    expect(d.statuses['stale']).toBeUndefined()
  })

  it('spends only the current window entitlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 1, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      expect(d.compService.findComps).toHaveBeenCalledTimes(2)
      expect(res.processed).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets an unspent window carry over into the next one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 7, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9), mk('d', 9), mk('e', 9)] })
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      // Window 2 with nothing spent yet: 2 of its own + 2 carried over.
      expect(res.processed).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the monthly budget above the window entitlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 13, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
      // startOfMonth falls on the 1st, startOfDay on the 2nd: the mock tells the
      // two calls apart by the day of month it is asked about.
      d.budgetRepository.countSince = vi.fn(async (since: Date) => (since.getDate() === 1 ? 249 : 0))
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
      )
      const res = await useCase.execute()
      // Window 3 would allow 6, the monthly cap allows 1.
      expect(res.processed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a removed listing without spending a comp credit', async () => {
    const d = deps({ listings: [mk('gone', 9)] })
    const availability = { isGone: vi.fn(async () => true) }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, availability,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(d.budgetRepository.recordCall).not.toHaveBeenCalled()
    expect(d.statuses['gone']).toBe(ListingStatus.IGNORED)
    expect(res.ignored).toBe(1)
  })

  it('proceeds with comp analysis when the availability probe is inconclusive', async () => {
    const d = deps({ listings: [mk('alive', 9)], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    const availability = { isGone: vi.fn(async () => false) }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, availability,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).toHaveBeenCalledOnce()
    expect(res.analyzed).toBe(1)
  })

  it('skips a near-duplicate of a rejected listing before spending a comp credit', async () => {
    const d = deps({ listings: [mk('dup', 9, 120, { title: 'Lampe laiton générique' })] })
    const embedder = { embed: vi.fn(async () => [0.1, 0.2, 0.3]) }
    const feedbackRepository = {
      findSimilar: vi.fn(async () => [{ listingTitle: 'x', priceCents: 9000, isGood: false, comment: 'trop cher pour la revente', similarity: 0.96 }]),
    } as any
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, similarFeedbackSkipThreshold: 0.92 },
      feedbackRepository, embedder,
    )
    const res = await useCase.execute()

    expect(feedbackRepository.findSimilar).toHaveBeenCalledOnce()
    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(d.budgetRepository.recordCall).not.toHaveBeenCalled()
    expect(d.statuses['dup']).toBe(ListingStatus.IGNORED)
    expect(res.ignored).toBe(1)
  })

  it('does not skip when the closest feedback is positive or below threshold', async () => {
    const d = deps({ listings: [mk('keep', 9, 120)], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    const embedder = { embed: vi.fn(async () => [0.1, 0.2, 0.3]) }
    const feedbackRepository = {
      // A liked piece at high similarity, plus a rejected one below threshold: neither should skip.
      findSimilar: vi.fn(async () => [{ listingTitle: 'x', priceCents: 9000, isGood: true, similarity: 0.99 }]),
    } as any
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, similarFeedbackSkipThreshold: 0.92 },
      feedbackRepository, embedder,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).toHaveBeenCalledOnce()
    expect(res.analyzed).toBe(1)
  })

  it('proceeds with comp analysis when the embedding check throws', async () => {
    const d = deps({ listings: [mk('resilient', 9, 120)], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    const embedder = { embed: vi.fn(async () => { throw new Error('embedding down') }) }
    const feedbackRepository = { findSimilar: vi.fn() } as any
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
      feedbackRepository, embedder,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).toHaveBeenCalledOnce()
    expect(res.analyzed).toBe(1)
  })

  it('ignores a listing with no value comps', async () => {
    const d = deps({ listings: [mk('a', 9)], comps: { matches: [
      { title: 'x', source: 'youtube', link: 'https://youtube.com/x', isValueDomain: false },
    ] } })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    await useCase.execute()
    expect(d.statuses['a']).toBe(ListingStatus.IGNORED)
    expect(d.saved).toHaveLength(0)
  })

  it('spends credits on the ranker picks in rank order', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
    const r = ranker([
      { listingId: 'c', rank: 1, worthCredit: true },
      { listingId: 'a', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank).toHaveBeenCalledTimes(1)
    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['c', 'a'])
  })

  it('skips a pick the ranker judged not worth a credit', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: false },
      { listingId: 'b', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['b'])
  })

  it('defers the whole window when the ranker abstains on everything', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, ranker([]) as any,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(res.processed).toBe(0)
    expect(res.deferred).toBe(2)
  })

  it('falls back to the deterministic order when the ranker throws', async () => {
    const d = deps({ listings: [mk('stale', 9, 80, { createdAt: new Date(2020, 0, 1) }), mk('fresh', 9)] })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 1, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, ranker(new Error('429')) as any,
    )
    const res = await useCase.execute()

    // Equal scores, so freshness decides — and the credit is still spent.
    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['fresh'])
    expect(res.deferred).toBe(0)
  })

  it('caps the shortlist submitted to the ranker', async () => {
    const listings = Array.from({ length: 30 }, (_, i) => mk(`l${i}`, 9))
    const d = deps({ listings })
    const r = ranker([{ listingId: 'l0', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1, rankingShortlistSize: 5 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][0]).toHaveLength(5)
  })

  it('probes availability only for the picks, not the whole shortlist', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9), mk('c', 9)] })
    const availabilityService = { isGone: vi.fn(async () => false) }
    const r = ranker([{ listingId: 'b', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, availabilityService as any, r as any,
    )
    await useCase.execute()

    expect(availabilityService.isGone).toHaveBeenCalledTimes(1)
  })

  it('never offers the ranker a listing the free filters reject', async () => {
    const d = deps({
      listings: [
        mk('replica', 9, 500, { title: 'Table dans le style de Willy Rizzo' }),
        mk('clean', 9),
      ],
    })
    const r = ranker([{ listingId: 'clean', rank: 1, worthCredit: true }])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][0].map((c: any) => c.listingId)).toEqual(['clean'])
    expect(d.statuses['replica']).toBe(ListingStatus.IGNORED)
  })

  it('does not blame the ranker for credits lost to the availability probe, not the ranker declining them', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const availabilityService = { isGone: vi.fn(async () => true) }
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: true },
      { listingId: 'b', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, availabilityService as any, r as any,
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    // Both picks sold out from under the ranker: the window's 2 credits were never
    // actually offered a chance, so this must not read as ranker severity.
    expect(res.deferred).toBe(0)
    expect(res.ignored).toBe(2)
    expect(d.statuses['a']).toBe(ListingStatus.IGNORED)
    expect(d.statuses['b']).toBe(ListingStatus.IGNORED)
  })

  it('reports zero deferred when the ranker wired picks are all successfully spent', async () => {
    const d = deps({
      listings: [mk('a', 9), mk('b', 9)],
      comps: { matches: [
        { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
        { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
        { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
      ] },
    })
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: true },
      { listingId: 'b', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    const res = await useCase.execute()

    expect(res.processed).toBe(2)
    expect(res.deferred).toBe(0)
  })

  it('does not report unspent credits as deferred when no ranker is wired', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
    )
    const res = await useCase.execute()

    // Only 2 candidates existed for an 8-credit window: the shortfall is supply,
    // not a ranker declining picks, and there is no ranker here to blame anyway.
    expect(res.deferred).toBe(0)
  })

  it('logs the listing id, rank and reason of every ranking pick for a successful call', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: true, reason: 'strong patina, likely genuine' },
      { listingId: 'b', rank: 2, worthCredit: false, reason: 'looks mass-market' },
    ])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    try {
      await useCase.execute()

      const logged = JSON.stringify(logSpy.mock.calls)
      expect(logged).toContain('a')
      expect(logged).toContain('1')
      expect(logged).toContain('strong patina, likely genuine')
      expect(logged).toContain('b')
      expect(logged).toContain('2')
      expect(logged).toContain('looks mass-market')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('drops a duplicate listingId returned by the ranker so it does not spend two credits', async () => {
    const d = deps({ listings: [mk('a', 9), mk('b', 9)] })
    const r = ranker([
      { listingId: 'a', rank: 1, worthCredit: true },
      { listingId: 'a', rank: 2, worthCredit: true },
    ])
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any,
    )
    await useCase.execute()

    expect(d.budgetRepository.recordCall.mock.calls.map((c: any[]) => c[0])).toEqual(['a'])
  })

  it('passes the learned guidance to the ranker', async () => {
    const d = deps({ listings: [mk('a', 9)] })
    const r = ranker([{ listingId: 'a', rank: 1, worthCredit: true }])
    const guidanceRepository = { getLatest: vi.fn(async () => ({ content: 'prefer brass' })) }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any, guidanceRepository as any,
    )
    await useCase.execute()

    expect(r.rank.mock.calls[0][1]).toBe('prefer brass')
  })

  it('skips the ranking stage entirely when the window already ran', async () => {
    const d = deps({ listings: [mk('a', 9)] })
    const r = ranker([{ listingId: 'a', rank: 1, worthCredit: true }])
    const rankingWindowRepository = {
      wasRanked: vi.fn(async () => true),
      markRanked: vi.fn(async () => {}),
    }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, r as any, undefined, rankingWindowRepository as any,
    )
    const res = await useCase.execute()

    // No pass one, no ranker call — the window's one attempt was already spent.
    expect(d.listingRepository.findByStatus).not.toHaveBeenCalled()
    expect(r.rank).not.toHaveBeenCalled()
    expect(res).toEqual({ processed: 0, analyzed: 0, ignored: 0, expired: 0, deferred: 0 })
  })

  it('marks the window as ranked after consulting the ranker, including a full abstention', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 1, 0, 0))
    try {
      const d = deps({ listings: [mk('a', 9)] })
      const r = ranker([]) // total abstention — still a real consultation
      const rankingWindowRepository = {
        wasRanked: vi.fn(async () => false),
        markRanked: vi.fn(async () => {}),
      }
      const useCase = new RunCompAnalysisUseCase(
        d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
        { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, windowsPerDay: 4 },
        undefined, undefined, undefined, r as any, undefined, rankingWindowRepository as any,
      )
      await useCase.execute()

      const expectedKey = currentWindowKey(4, new Date(2026, 7, 2, 1, 0, 0))
      expect(rankingWindowRepository.markRanked).toHaveBeenCalledWith(expectedKey)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mark the window when the ranker throws and falls back', async () => {
    const d = deps({ listings: [mk('a', 9)] })
    const rankingWindowRepository = {
      wasRanked: vi.fn(async () => false),
      markRanked: vi.fn(async () => {}),
    }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 2, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, ranker(new Error('429')) as any, undefined, rankingWindowRepository as any,
    )
    await useCase.execute()

    expect(rankingWindowRepository.markRanked).not.toHaveBeenCalled()
  })

  it('never checks or marks the window when no ranker is wired, even with the repository present', async () => {
    const d = deps({ listings: [mk('a', 9)] })
    const rankingWindowRepository = {
      wasRanked: vi.fn(async () => false),
      markRanked: vi.fn(async () => {}),
    }
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1 },
      undefined, undefined, undefined, undefined, undefined, rankingWindowRepository as any,
    )
    await useCase.execute()

    expect(rankingWindowRepository.wasRanked).not.toHaveBeenCalled()
    expect(rankingWindowRepository.markRanked).not.toHaveBeenCalled()
  })
})

describe('windowEntitlement', () => {
  const at = (hour: number) => new Date(2026, 7, 2, hour, 0, 0)

  it('accrues one share of the daily budget per elapsed window', () => {
    expect(windowEntitlement(8, 4, 0, at(1))).toBe(2)
    expect(windowEntitlement(8, 4, 0, at(7))).toBe(4)
    expect(windowEntitlement(8, 4, 0, at(13))).toBe(6)
    expect(windowEntitlement(8, 4, 0, at(23))).toBe(8)
  })

  it('carries an unspent window over to the next one', () => {
    // Nothing spent in window 1: window 2 offers both its own share and the
    // deferred one.
    expect(windowEntitlement(8, 4, 0, at(7))).toBe(4)
    // Two already spent in window 1: window 2 offers only its own share.
    expect(windowEntitlement(8, 4, 2, at(7))).toBe(2)
  })

  it('never goes negative when the day is already overspent', () => {
    expect(windowEntitlement(8, 4, 5, at(1))).toBe(0)
  })

  it('reduces to the plain daily budget with a single window', () => {
    expect(windowEntitlement(8, 1, 7, at(1))).toBe(1)
  })

  it('clamps accrued entitlement to the daily budget (fractional windowsPerDay, DST-like overshoot)', () => {
    // windowsPerDay=1.5 at 20:00 -> elapsed=2, accrued=floor(8*2/1.5)=10, which must
    // not exceed the 8-credit daily budget.
    expect(windowEntitlement(8, 1.5, 0, at(20))).toBe(8)
  })
})
