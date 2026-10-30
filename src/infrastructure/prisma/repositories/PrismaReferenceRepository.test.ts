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
  referenceId: 'a1', name: 'Royère armchairs', note: 'note', maxPriceCents: null, source: 'ARTCURIAL',
  similarity: 0.74, textHit: true, imageUrls: ['https://ref/a1.jpg'],
  house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: 'https://lot', saleName: 'Design',
  soldAt: new Date('2026-05-12T00:00:00Z'), title: 'Paire de fauteuils', artist: 'Jean Royère',
  hammerCents: 220000, quantity: 2, hammerPerUnitCents: 110000,
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
    expect(data.source).toBe('ARTCURIAL'); expect(data.maxPriceCents).toBeNull(); expect(data.backfilledAt).toBeInstanceOf(Date)
    expect(data.auctionLot.create).toMatchObject({ house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', hammerPerUnitCents: 110000 })
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
    expect(res.map((c) => [c.referenceId, c.source])).toEqual([['m1', 'MANUAL'], ['a1', 'ARTCURIAL']])
    expect(res[0].auction).toBeNull()
    expect(res[1].auction).toEqual({
      house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: 'https://lot', saleName: 'Design',
      soldAt: new Date('2026-05-12T00:00:00Z'), title: 'Paire de fauteuils', artist: 'Jean Royère',
      hammerCents: 220000, quantity: 2, hammerPerUnitCents: 110000,
    })
    expect(res[1].similarity).toBe(0.74)
  })

  it('countAuctionVerificationsSince counts matches of ARTCURIAL references', async () => {
    const queryRaw = vi.fn(async () => [{ count: 7n }])
    const n = await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).countAuctionVerificationsSince(new Date('2026-10-30T00:00:00Z'))
    expect(n).toBe(7)
  })

  it('auctionFundStats reports lots, images and embedded images', async () => {
    const count = vi.fn(async () => 12)
    const queryRaw = vi.fn().mockResolvedValueOnce([{ count: 40n }]).mockResolvedValueOnce([{ count: 31n }])
    const stats = await new PrismaReferenceRepository({ photoReference: { count }, $queryRaw: queryRaw } as any).auctionFundStats()
    expect(stats).toEqual({ lots: 12, images: 40, embedded: 31 })
    expect(count).toHaveBeenCalledWith({ where: { source: 'ARTCURIAL' } })
  })
})
