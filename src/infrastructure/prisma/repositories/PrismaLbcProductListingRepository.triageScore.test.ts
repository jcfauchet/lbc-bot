import { describe, it, expect, vi } from 'vitest'
import { PrismaLbcProductListingRepository } from './PrismaLbcProductListingRepository'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

function makeRawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    lbcId: 'lbc-42',
    searchId: 'search-1',
    url: 'https://www.leboncoin.fr/42',
    title: 'Vintage lamp',
    priceCents: 5000,
    city: 'Paris',
    region: 'Ile-de-France',
    publishedAt: new Date('2026-01-01'),
    status: ListingStatus.TRIAGED,
    ignoreReason: null,
    triageScore: 7,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeTriagedListing(score: number): Listing {
  const listing = Listing.fromPersistence({
    id: 'listing-1',
    lbcId: 'lbc-42',
    searchId: 'search-1',
    url: 'https://www.leboncoin.fr/42',
    title: 'Vintage lamp',
    price: Money.fromCents(5000),
    city: 'Paris',
    region: 'Ile-de-France',
    publishedAt: new Date('2026-01-01'),
    status: ListingStatus.TRIAGED,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  })
  listing.markAsTriaged(score)
  return listing
}

describe('PrismaLbcProductListingRepository – triageScore persistence', () => {
  it('update() passes triageScore in the data argument', async () => {
    const raw = makeRawRow()
    const updateMock = vi.fn(async () => raw)
    const prisma = { lbcProductListing: { update: updateMock } } as any
    const repo = new PrismaLbcProductListingRepository(prisma)
    const listing = makeTriagedListing(7)

    await repo.update(listing)

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ triageScore: 7 }),
      }),
    )
  })

  it('toDomain round-trips triageScore from the raw row', async () => {
    const raw = makeRawRow({ triageScore: 7 })
    const findManyMock = vi.fn(async () => [raw])
    const prisma = { lbcProductListing: { findMany: findManyMock } } as any
    const repo = new PrismaLbcProductListingRepository(prisma)

    const results = await repo.findByStatus(ListingStatus.TRIAGED)

    expect(results).toHaveLength(1)
    expect(results[0].triageScore).toBe(7)
  })
})
