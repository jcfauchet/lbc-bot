import { describe, it, expect, vi } from 'vitest'
import { RunPreFilterUseCase } from './RunPreFilterUseCase'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const mkListing = (title: string, euros: number) =>
  Listing.create({ lbcId: 'a', searchId: 's', url: 'u', title, price: Money.fromEuros(euros), status: ListingStatus.NEW })

describe('RunPreFilterUseCase', () => {
  it('prefilters a good cheap listing and ignores an excluded one', async () => {
    const good = mkListing('lampadaire laiton vintage', 80)
    const bad = mkListing('table IKEA', 80)
    const updated: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [good, bad]),
      update: vi.fn(async (l: Listing) => { updated[l.title] = l.status; return l }),
    } as any
    const textFilterService = {
      shouldExclude: (t: string) => t.includes('IKEA') ? { exclude: true, reason: 'ikea' } : { exclude: false },
    } as any

    const useCase = new RunPreFilterUseCase(listingRepository, textFilterService, { minEuros: 50, maxEuros: 700 })
    const res = await useCase.execute()

    expect(updated['lampadaire laiton vintage']).toBe(ListingStatus.PREFILTERED)
    expect(updated['table IKEA']).toBe(ListingStatus.IGNORED)
    expect(res).toEqual({ prefiltered: 1, ignored: 1 })
  })

  it('ignores listings priced above the max', async () => {
    const pricey = mkListing('console laiton', 2000)
    const updated: Record<string, ListingStatus> = {}
    const listingRepository = {
      findByStatus: vi.fn(async () => [pricey]),
      update: vi.fn(async (l: Listing) => { updated[l.title] = l.status; return l }),
    } as any
    const textFilterService = { shouldExclude: () => ({ exclude: false }) } as any

    const useCase = new RunPreFilterUseCase(listingRepository, textFilterService, { minEuros: 50, maxEuros: 700 })
    await useCase.execute()
    expect(updated['console laiton']).toBe(ListingStatus.IGNORED)
  })
})
