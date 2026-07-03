import { describe, it, expect, vi } from 'vitest'
import { RunTriageUseCase } from './RunTriageUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mk = (id: string) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: 't', price: Money.fromEuros(80), status: ListingStatus.PREFILTERED })
  ;(l as any).props = { ...(l as any).props, id }
  return l
}

const guidanceRepo = (content: string | null = null) =>
  ({ getLatest: vi.fn(async () => (content ? { id: 'g', content, sourceFeedbackCount: 1, createdAt: new Date() } : null)), save: vi.fn() } as any)

describe('RunTriageUseCase', () => {
  it('triages above threshold and ignores below', async () => {
    const high = mk('h'); const low = mk('l')
    const out: Record<string, { status: ListingStatus; score?: number }> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [high, low]),
      update: vi.fn(async (l: Listing) => { out[l.id] = { status: l.status, score: l.triageScore }; return l }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any
    const triageService = {
      providerName: 'gemini',
      triage: vi.fn(),
    } as any
    triageService.triage
      .mockResolvedValueOnce({ score: 8 })
      .mockResolvedValueOnce({ score: 2 })

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5, 100, guidanceRepo())
    const res = await useCase.execute()

    expect(out['h'].status).toBe(ListingStatus.TRIAGED)
    expect(out['h'].score).toBe(8)
    expect(out['l'].status).toBe(ListingStatus.IGNORED)
    expect(res).toEqual({ triaged: 1, ignored: 1 })
  })

  it('processes at most maxPerRun listings, newest first', async () => {
    const mkAt = (id: string, createdAt: Date) => {
      const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: 't', price: Money.fromEuros(80), status: ListingStatus.PREFILTERED })
      ;(l as any).props = { ...(l as any).props, id, createdAt }
      return l
    }
    const older = mkAt('older', new Date('2026-06-01T10:00:00Z'))
    const newer = mkAt('newer', new Date('2026-06-06T10:00:00Z'))
    const out: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [older, newer]),
      update: vi.fn(async (l: Listing) => { out[l.id] = l.status; return l }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any
    const triageService = { providerName: 'gemini', triage: vi.fn(async () => ({ score: 8 })) } as any

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5, 1, guidanceRepo())
    const res = await useCase.execute()

    expect(triageService.triage).toHaveBeenCalledTimes(1)
    expect(out['newer']).toBe(ListingStatus.TRIAGED)
    expect(out['older']).toBeUndefined()
    expect(res.triaged).toBe(1)
  })

  it('ignores listings with no image', async () => {
    const l = mk('n')
    const out: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [l]),
      update: vi.fn(async (x: Listing) => { out[x.id] = x.status; return x }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => []) } as any
    const triageService = { providerName: 'gemini', triage: vi.fn() } as any

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5, 100, guidanceRepo())
    await useCase.execute()

    expect(out['n']).toBe(ListingStatus.IGNORED)
    expect(triageService.triage).not.toHaveBeenCalled()
  })

  it('skips a listing whose triage throws, ignores it, and continues to the next', async () => {
    const bad = mk('bad'); const good = mk('good')
    const out: Record<string, { status: ListingStatus; reason?: string }> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [bad, good]),
      update: vi.fn(async (l: Listing) => { out[l.id] = { status: l.status, reason: l.ignoreReason }; return l }),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any
    const triageService = { providerName: 'gemini', triage: vi.fn() } as any
    triageService.triage
      .mockRejectedValueOnce(new Error('vision API 400'))
      .mockResolvedValueOnce({ score: 8 })

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5, 100, guidanceRepo())
    const res = await useCase.execute()

    // The bad listing must not abort the run; the good one is still triaged.
    expect(out['bad'].status).toBe(ListingStatus.IGNORED)
    expect(out['good'].status).toBe(ListingStatus.TRIAGED)
    expect(res.triaged).toBe(1)
  })

  it('forwards the latest guidance to the triage service', async () => {
    const listingRepository = {
      findByStatus: vi.fn(async () => [mk('h')]),
      update: vi.fn(async (l: Listing) => l),
    } as any
    const imageRepository = { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any
    const triageService = { providerName: 'gemini', triage: vi.fn(async () => ({ score: 8 })) } as any

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5, 100, guidanceRepo('- avoid repros'))
    await useCase.execute()

    expect(triageService.triage).toHaveBeenCalledWith(
      { imageUrl: 'https://img/x.jpg', title: 't', priceEur: 80 },
      '- avoid repros',
    )
  })
})
