import { describe, it, expect, vi } from 'vitest'
import { PrismaRankingWindowRepository } from './PrismaRankingWindowRepository'

describe('PrismaRankingWindowRepository', () => {
  it('wasRanked returns true when a row exists for the window key', async () => {
    const findUnique = vi.fn(async () => ({ id: '1', windowKey: '2026-08-02T00:00:00.000Z', createdAt: new Date() }))
    const prisma = { rankingWindow: { findUnique } } as any
    const repo = new PrismaRankingWindowRepository(prisma)

    const result = await repo.wasRanked('2026-08-02T00:00:00.000Z')

    expect(result).toBe(true)
    expect(findUnique).toHaveBeenCalledWith({ where: { windowKey: '2026-08-02T00:00:00.000Z' } })
  })

  it('wasRanked returns false when no row exists for the window key', async () => {
    const findUnique = vi.fn(async () => null)
    const prisma = { rankingWindow: { findUnique } } as any
    const repo = new PrismaRankingWindowRepository(prisma)

    const result = await repo.wasRanked('2026-08-02T00:00:00.000Z')

    expect(result).toBe(false)
  })

  it('markRanked upserts a row for the window key', async () => {
    const upsert = vi.fn(async () => ({}))
    const prisma = { rankingWindow: { upsert } } as any
    const repo = new PrismaRankingWindowRepository(prisma)

    await repo.markRanked('2026-08-02T00:00:00.000Z')

    expect(upsert).toHaveBeenCalledWith({
      where: { windowKey: '2026-08-02T00:00:00.000Z' },
      create: { windowKey: '2026-08-02T00:00:00.000Z' },
      update: {},
    })
  })
})
