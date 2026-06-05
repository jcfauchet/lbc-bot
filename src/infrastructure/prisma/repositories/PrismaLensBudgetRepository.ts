import type { PrismaClient } from '@prisma/client'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'

export class PrismaLensBudgetRepository implements ILensBudgetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countSince(since: Date): Promise<number> {
    return this.prisma.lensCall.count({ where: { createdAt: { gte: since } } })
  }

  async recordCall(listingId: string | null, success: boolean): Promise<void> {
    await this.prisma.lensCall.create({ data: { listingId, success } })
  }
}
