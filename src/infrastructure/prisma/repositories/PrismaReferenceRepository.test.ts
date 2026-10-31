import { describe, it, expect, vi } from 'vitest'
import { PrismaReferenceRepository } from './PrismaReferenceRepository'
import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'

const newLot = (overrides: Partial<NewAuctionLot> = {}): NewAuctionLot => ({
  name: 'Jean Royère, pair of armchairs',
  note: 'Sold 1 100 € each',
  keywords: ['royère'],
  imageUrls: ['u1'],
  lot: {
    house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: 'https://www.artcurial.com/fr/lot-278-a',
    saleName: 'Design', soldAt: new Date('2026-05-12T00:00:00Z'), title: 'Paire de fauteuils',
    artist: 'Jean Royère', artistYears: '1902-1981', description: 'Oak and fabric',
    estimateLowCents: 150000, estimateHighCents: 200000, hammerCents: 220000, finalCents: 275000,
    quantity: 2, hammerPerUnitCents: 110000,
  },
  ...overrides,
})

const manualRow = {
  referenceId: 'm1', name: 'Desserte Jansen', note: null, maxPriceCents: 20000, source: 'MANUAL',
  similarity: 0.81, textHit: false, imageUrls: ['https://ref/m1.jpg'],
}
const auctionRow = {
  referenceId: 'a1', name: 'Royère armchairs', note: 'note', maxPriceCents: null, source: 'AUCTION',
  similarity: 0.74, textHit: true, imageUrls: ['https://ref/a1.jpg'],
  house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: 'https://lot', saleName: 'Design',
  soldAt: new Date('2026-05-12T00:00:00Z'), title: 'Paire de fauteuils', artist: 'Jean Royère',
  hammerCents: 220000, quantity: 2, hammerPerUnitCents: 110000, finalCents: 275000, hammerIsEstimated: false,
}

describe('PrismaReferenceRepository', () => {
  it('createAuctionLot returns null when the lot already exists', async () => {
    const prisma = { auctionLot: { findUnique: vi.fn(async () => ({ id: 'a1' })) }, photoReference: { create: vi.fn() } } as any
    expect(await new PrismaReferenceRepository(prisma).createAuctionLot(newLot())).toBeNull()
    expect(prisma.photoReference.create).not.toHaveBeenCalled()
    expect(prisma.auctionLot.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { house_saleRef_lotRef: { house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a' } },
    }))
  })

  it('createAuctionLot creates the reference, its lot and every image, backfilled at once', async () => {
    const create = vi.fn(async (args: any) => ({ id: 'r1', images: args.data.images.create.map((i: any, n: number) => ({ id: `i${n}`, urlRemote: i.urlRemote })) }))
    const prisma = { auctionLot: { findUnique: vi.fn(async () => null) }, photoReference: { create } } as any
    const res = await new PrismaReferenceRepository(prisma).createAuctionLot(newLot({ imageUrls: ['u1', 'u2', 'u3', 'u4'] }))
    expect(res).toEqual({ id: 'r1', images: [{ id: 'i0', url: 'u1' }, { id: 'i1', url: 'u2' }, { id: 'i2', url: 'u3' }, { id: 'i3', url: 'u4' }] })
    const data = (create.mock.calls[0] as any[])[0].data
    expect(data.source).toBe('AUCTION'); expect(data.maxPriceCents).toBeNull(); expect(data.backfilledAt).toBeInstanceOf(Date)
    expect(data.auctionLot.create).toMatchObject({ house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', hammerPerUnitCents: 110000 })
  })

  it('findExistingLotRefs returns the stored lot refs of one sale', async () => {
    const findMany = vi.fn(async (_args: any) => [{ lotRef: '1-a' }, { lotRef: '278-a' }])
    const refs = await new PrismaReferenceRepository({ auctionLot: { findMany } } as any).findExistingLotRefs('ARTCURIAL', 'IT6064')
    expect(refs).toEqual(new Set(['1-a', '278-a']))
    expect(findMany).toHaveBeenCalledWith({ where: { house: 'ARTCURIAL', saleRef: 'IT6064' }, select: { lotRef: true } })
  })

  it('hasActiveReferences counts auction lots only when asked to', async () => {
    const count = vi.fn(async (_args: any) => 0)
    const repo = new PrismaReferenceRepository({ photoReference: { count } } as any)
    expect(await repo.hasActiveReferences(false)).toBe(false)
    expect(count.mock.calls[0][0]).toEqual({ where: { isActive: true, source: 'MANUAL' } })
    count.mockResolvedValueOnce(3)
    expect(await repo.hasActiveReferences(true)).toBe(true)
    expect(count.mock.calls[1][0]).toEqual({ where: { isActive: true } })
  })

  it('list only returns manual references', async () => {
    const findMany = vi.fn(async (_args: any) => [])
    await new PrismaReferenceRepository({ photoReference: { findMany } } as any).list()
    expect(findMany.mock.calls[0][0].where).toEqual({ source: 'MANUAL' })
  })

  it('findCandidates skips the auction query when the fund is disabled', async () => {
    const queryRaw = vi.fn(async () => [])
    await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).findCandidates('l1', { minSimilarity: 0.78, keywordMinSimilarity: 0.7, auctionLimit: 3, includeAuction: false })
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it('findCandidates puts manual candidates before auction ones', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([manualRow])
      .mockResolvedValueOnce([auctionRow])
    const res = await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).findCandidates('l1', { minSimilarity: 0.78, keywordMinSimilarity: 0.7, auctionLimit: 3, includeAuction: true })
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(res.map((c) => [c.referenceId, c.source])).toEqual([['m1', 'MANUAL'], ['a1', 'AUCTION']])
    const auctionSql = (queryRaw.mock.calls[1][0] as string[]).join('?')
    expect(auctionSql).toContain(`r."source" <> 'MANUAL'`)
    expect(auctionSql).toContain(`'AUCTION' AS "source"`)
    expect(auctionSql).not.toContain(`'ARTCURIAL'`)
    expect(res[0].auction).toBeNull()
    expect(res[1].auction).toEqual({
      house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: 'https://lot', saleName: 'Design',
      soldAt: new Date('2026-05-12T00:00:00Z'), title: 'Paire de fauteuils', artist: 'Jean Royère',
      hammerCents: 220000, quantity: 2, hammerPerUnitCents: 110000, finalCents: 275000, hammerIsEstimated: false,
    })
    expect(res[1].similarity).toBe(0.74)
    expect(auctionSql).toContain(`a."finalCents" IS NOT NULL) AS "hammerIsEstimated"`)
    expect(queryRaw.mock.calls[1]).toContain('ARTCURIAL')
  })

  it('findCandidates maps an estimated hammer from the auction query', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...auctionRow, house: 'OSENAT', finalCents: 125000, hammerIsEstimated: true }])
    const res = await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).findCandidates('l1', { minSimilarity: 0.78, keywordMinSimilarity: 0.7, auctionLimit: 3, includeAuction: true })
    expect(res[0].auction).toMatchObject({ house: 'OSENAT', finalCents: 125000, hammerIsEstimated: true })
  })

  describe('findPendingAlerts', () => {
    const match = (auctionLot: Record<string, unknown>) => ({
      id: 'm1', listingId: 'l1', reason: 'same frame', similarity: 0.8,
      reference: { name: 'ref', source: 'AUCTION', images: [], auctionLot },
      listing: { title: 'Fauteuil', url: 'https://lbc/l1', priceCents: 12000, city: 'Lyon', images: [] },
    })
    const lot = { ...newLot().lot, id: 'lot1', referenceId: 'a1' }
    const alertsFor = async (auctionLot: Record<string, unknown>) => {
      const findMany = vi.fn(async () => [match(auctionLot)])
      return new PrismaReferenceRepository({ referenceMatch: { findMany } } as any).findPendingAlerts()
    }

    it('keeps an Artcurial hammer as real even with a final price', async () => {
      const [alert] = await alertsFor(lot)
      expect(alert.auction).toMatchObject({ house: 'ARTCURIAL', finalCents: 275000, hammerIsEstimated: false })
    })

    it('flags a hammer derived from a fee-inclusive price as estimated', async () => {
      const [alert] = await alertsFor({ ...lot, house: 'OSENAT', finalCents: 125000 })
      expect(alert.auction).toMatchObject({ house: 'OSENAT', finalCents: 125000, hammerIsEstimated: true })
    })

    it('keeps a hammer-only result from another house as real', async () => {
      const [alert] = await alertsFor({ ...lot, house: 'ROSSINI', finalCents: null })
      expect(alert.auction).toMatchObject({ house: 'ROSSINI', finalCents: null, hammerIsEstimated: false })
    })
  })

  it('countAuctionVerificationsSince counts matches of every non-manual reference', async () => {
    const queryRaw = vi.fn(async (..._args: any[]) => [{ count: 7n }])
    const n = await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).countAuctionVerificationsSince(new Date('2026-10-30T00:00:00Z'))
    expect(n).toBe(7)
    const sql = (queryRaw.mock.calls[0][0] as string[]).join('?')
    expect(sql).toContain(`r."source" <> 'MANUAL'`)
    expect(sql).not.toContain(`'ARTCURIAL'`)
  })

  it('auctionFundStats reports lots, images, embedded images and lots per house', async () => {
    const count = vi.fn(async () => 12)
    const groupBy = vi.fn(async (_args: any) => [{ house: 'ARTCURIAL', _count: 12 }])
    const queryRaw = vi.fn().mockResolvedValueOnce([{ count: 40n }]).mockResolvedValueOnce([{ count: 31n }])
    const stats = await new PrismaReferenceRepository({ photoReference: { count }, auctionLot: { groupBy }, $queryRaw: queryRaw } as any).auctionFundStats()
    expect(stats).toEqual({ lots: 12, images: 40, embedded: 31, byHouse: [{ house: 'ARTCURIAL', lots: 12 }] })
    expect(count).toHaveBeenCalledWith({ where: { source: { not: 'MANUAL' } } })
    expect(groupBy).toHaveBeenCalledWith({ by: ['house'], _count: true })
    for (const call of queryRaw.mock.calls) {
      const sql = (call[0] as string[]).join('?')
      expect(sql).toContain(`r."source" <> 'MANUAL'`)
      expect(sql).not.toContain(`'ARTCURIAL'`)
    }
  })
})
