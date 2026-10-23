import type { PrismaClient } from '@prisma/client'
import type {
  AppraisalRunRecord,
  IPipelineTrackingRepository,
  ScrapeAttemptRecord,
} from '@/domain/repositories/IPipelineTrackingRepository'

export class PrismaPipelineTrackingRepository implements IPipelineTrackingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordScrapeAttempt(attempt: ScrapeAttemptRecord): Promise<void> {
    await this.prisma.scrapeAttempt.create({ data: attempt })
  }

  async recordAppraisalRun(run: AppraisalRunRecord): Promise<void> {
    await this.prisma.appraisalRun.create({ data: run })
  }
}
