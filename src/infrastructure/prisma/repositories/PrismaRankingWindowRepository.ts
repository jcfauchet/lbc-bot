import type { PrismaClient } from '@prisma/client'
import type { IRankingWindowRepository } from '@/domain/repositories/IRankingWindowRepository'

export class PrismaRankingWindowRepository implements IRankingWindowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async wasRanked(windowKey: string): Promise<boolean> {
    const row = await this.prisma.rankingWindow.findUnique({ where: { windowKey } })
    return row !== null
  }

  async markRanked(windowKey: string): Promise<void> {
    // Upsert rather than create: two overlapping cron invocations racing to mark
    // the same window must not throw a unique-constraint error.
    await this.prisma.rankingWindow.upsert({
      where: { windowKey },
      create: { windowKey },
      update: {},
    })
  }
}
