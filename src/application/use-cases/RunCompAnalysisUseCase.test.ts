import { describe, it, expect, vi } from 'vitest'
import { RunCompAnalysisUseCase } from './RunCompAnalysisUseCase'
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

  it('lets a fresh high-score listing spend the fast-track bonus after the daily budget is gone', async () => {
    const gem = mk('gem', 9, 60) // created now => fresh
    const ordinary = mk('ordinary', 8, 60)
    const d = deps({ listings: [ordinary, gem], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    d.budgetRepository.countSince = vi.fn(async () => 8) // daily budget fully spent
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, fastTrackDailyExtra: 2, fastTrackMinScore: 9, fastTrackFreshHours: 24 },
    )
    const res = await useCase.execute()

    // Only the fast-track gem gets a bonus credit; the ordinary listing waits.
    expect(d.statuses['gem']).toBe(ListingStatus.ANALYZED)
    expect(d.statuses['ordinary']).toBeUndefined()
    expect(res.analyzed).toBe(1)
  })

  it('fast-track jumps the queue ahead of a higher-scored stale listing', async () => {
    const staleTop = mk('staleTop', 10, 60, { createdAt: new Date(Date.now() - 72 * 3_600_000) })
    const freshGem = mk('freshGem', 9, 60) // created now => fast-track
    const d = deps({ listings: [staleTop, freshGem], comps: { matches: [
      { title: 'a', source: '1stdibs', link: 'https://1stdibs.com/a', isValueDomain: true, price: { value: 1000, currency: 'EUR' } },
      { title: 'b', source: '1stdibs', link: 'https://1stdibs.com/b', isValueDomain: true, price: { value: 2000, currency: 'EUR' } },
      { title: 'c', source: '1stdibs', link: 'https://1stdibs.com/c', isValueDomain: true, price: { value: 3000, currency: 'EUR' } },
    ] } })
    d.budgetRepository.countSince = vi.fn(async () => 7) // 1 credit left
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, fastTrackDailyExtra: 0, fastTrackMinScore: 9, fastTrackFreshHours: 24 },
    )
    await useCase.execute()

    expect(d.statuses['freshGem']).toBe(ListingStatus.ANALYZED)
    expect(d.statuses['staleTop']).toBeUndefined()
  })

  it('never exceeds the monthly budget even for fast-track listings', async () => {
    const gem = mk('gem', 9, 60)
    const d = deps({ listings: [gem] })
    d.budgetRepository.countSince = vi.fn(async () => 250) // monthly cap reached
    const useCase = new RunCompAnalysisUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.imageRepository, d.compService, d.budgetRepository,
      { dailyBudget: 8, monthlyBudget: 250, resaleFactor: 1, fastTrackDailyExtra: 2 },
    )
    const res = await useCase.execute()

    expect(d.compService.findComps).not.toHaveBeenCalled()
    expect(res.processed).toBe(0)
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
})
