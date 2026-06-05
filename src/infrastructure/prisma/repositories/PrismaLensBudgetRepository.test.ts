import { describe, it, expect, vi } from 'vitest'
import { PrismaLensBudgetRepository } from './PrismaLensBudgetRepository'

describe('PrismaLensBudgetRepository', () => {
  it('countSince delegates to lensCall.count with a createdAt gte filter', async () => {
    const count = vi.fn(async () => 3)
    const prisma = { lensCall: { count } } as any
    const repo = new PrismaLensBudgetRepository(prisma)
    const since = new Date('2026-06-05T00:00:00Z')

    const n = await repo.countSince(since)

    expect(n).toBe(3)
    expect(count).toHaveBeenCalledWith({ where: { createdAt: { gte: since } } })
  })

  it('recordCall creates a row', async () => {
    const create = vi.fn(async () => ({}))
    const prisma = { lensCall: { create } } as any
    const repo = new PrismaLensBudgetRepository(prisma)

    await repo.recordCall('listing-1', true)

    expect(create).toHaveBeenCalledWith({ data: { listingId: 'listing-1', success: true } })
  })
})
