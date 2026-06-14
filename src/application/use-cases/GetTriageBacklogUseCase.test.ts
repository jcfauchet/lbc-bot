import { describe, it, expect, vi } from 'vitest'
import { GetTriageBacklogUseCase } from './GetTriageBacklogUseCase'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

const row = (id: string, score: number, img?: string) => ({
  id, title: `t-${id}`, url: `https://lbc/${id}`, priceCents: 5000,
  triageScore: score, city: 'Paris', createdAt: new Date('2026-06-14T10:00:00Z'),
  images: img ? [{ urlRemote: img }] : [],
})

describe('GetTriageBacklogUseCase', () => {
  it('returns triaged listings, highest score then newest, with the first image', async () => {
    const findMany = vi.fn(async (_args: any) => [row('a', 9, 'https://img/a.jpg'), row('b', 8)])
    const prisma = { lbcProductListing: { findMany } } as any

    const res = await new GetTriageBacklogUseCase(prisma).execute()

    const args = findMany.mock.calls[0][0] as any
    expect(args.where.status).toBe(ListingStatus.TRIAGED)
    expect(args.orderBy).toEqual([{ triageScore: 'desc' }, { createdAt: 'desc' }])
    expect(res[0]).toMatchObject({ id: 'a', triageScore: 9, imageUrl: 'https://img/a.jpg' })
    expect(res[1].imageUrl).toBeNull()
  })

  it('filters by minScore and caps with limit', async () => {
    const findMany = vi.fn(async (_args: any) => [] as any[])
    const prisma = { lbcProductListing: { findMany } } as any

    await new GetTriageBacklogUseCase(prisma).execute({ minScore: 8, limit: 50 })

    const args = findMany.mock.calls[0][0] as any
    expect(args.where.triageScore).toEqual({ gte: 8 })
    expect(args.take).toBe(50)
  })
})
