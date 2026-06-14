import { describe, it, expect, vi } from 'vitest'
import { RunCompAnalysisUseCase } from './RunCompAnalysisUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mk = (id: string, score: number, euros = 80, opts: { title?: string; description?: string } = {}) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: opts.title ?? id, description: opts.description, price: Money.fromEuros(euros), status: ListingStatus.TRIAGED })
  ;(l as any).props = { ...(l as any).props, id, triageScore: score }
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
