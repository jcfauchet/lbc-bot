import { PrismaClient } from '@prisma/client'
import {
  ITriageGuidanceRepository,
  TriageGuidance,
} from '@/domain/repositories/ITriageGuidanceRepository'

export class PrismaTriageGuidanceRepository implements ITriageGuidanceRepository {
  constructor(private prisma: PrismaClient) {}

  async getLatest(): Promise<TriageGuidance | null> {
    const row = await this.prisma.triageGuidance.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    if (!row) return null
    return {
      id: row.id,
      content: row.content,
      sourceFeedbackCount: row.sourceFeedbackCount,
      contentHash: row.contentHash ?? null,
      createdAt: row.createdAt,
    }
  }

  async save(content: string, sourceFeedbackCount: number, contentHash: string): Promise<TriageGuidance> {
    const row = await this.prisma.triageGuidance.create({
      data: { content, sourceFeedbackCount, contentHash },
    })
    return {
      id: row.id,
      content: row.content,
      sourceFeedbackCount: row.sourceFeedbackCount,
      contentHash: row.contentHash ?? null,
      createdAt: row.createdAt,
    }
  }
}
