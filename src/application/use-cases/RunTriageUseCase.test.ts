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

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5)
    const res = await useCase.execute()

    expect(out['h'].status).toBe(ListingStatus.TRIAGED)
    expect(out['h'].score).toBe(8)
    expect(out['l'].status).toBe(ListingStatus.IGNORED)
    expect(res).toEqual({ triaged: 1, ignored: 1 })
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

    const useCase = new RunTriageUseCase(listingRepository, imageRepository, triageService, 5)
    await useCase.execute()

    expect(out['n']).toBe(ListingStatus.IGNORED)
    expect(triageService.triage).not.toHaveBeenCalled()
  })
})
