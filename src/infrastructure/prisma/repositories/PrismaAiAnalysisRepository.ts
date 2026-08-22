import { PrismaClient } from '@prisma/client'
import {
  IAiAnalysisRepository,
  NotifiableDeal,
} from '@/domain/repositories/IAiAnalysisRepository'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { NotificationStatus } from '@/domain/entities/Notification'
import { Money } from '@/domain/value-objects/Money'
import { toListingDomain } from '@/infrastructure/prisma/mappers/listingMapper'

export class PrismaAiAnalysisRepository implements IAiAnalysisRepository {
  constructor(private prisma: PrismaClient) {}

  async save(analysis: AiAnalysis): Promise<AiAnalysis> {
    const data = {
      listingId: analysis.listingId,
      estMinCents: analysis.estimatedMinPrice.getCents(),
      estMaxCents: analysis.estimatedMaxPrice.getCents(),
      marginCents: analysis.margin.getCents(),
      description: analysis.description,
      confidence: analysis.confidence,
      provider: analysis.provider,
      bestMatchSource: analysis.bestMatchSource,
      searchTerms: analysis.searchTerms ? JSON.parse(JSON.stringify(analysis.searchTerms)) : null,
    }

    const created = await this.prisma.aiAnalysis.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<AiAnalysis | null> {
    const analysis = await this.prisma.aiAnalysis.findUnique({ where: { id } })
    return analysis ? this.toDomain(analysis) : null
  }

  async findByListingId(listingId: string): Promise<AiAnalysis | null> {
    const analysis = await this.prisma.aiAnalysis.findUnique({
      where: { listingId },
    })
    return analysis ? this.toDomain(analysis) : null
  }

  async findByMinMargin(minMargin: number): Promise<AiAnalysis[]> {
    const minMarginCents = minMargin * 100
    const analyses = await this.prisma.aiAnalysis.findMany({
      where: { marginCents: { gte: minMarginCents } },
      orderBy: { marginCents: 'desc' },
    })
    return analyses.map((a) => this.toDomain(a))
  }

  async findNotifiableByMinMargin(minMargin: number): Promise<NotifiableDeal[]> {
    const rows = await this.prisma.aiAnalysis.findMany({
      where: {
        marginCents: { gte: minMargin * 100 },
        listing: {
          notifications: { none: { status: NotificationStatus.SENT } },
        },
      },
      orderBy: { marginCents: 'desc' },
      include: {
        listing: {
          include: {
            // Only the thumbnail the digest renders is needed.
            images: { orderBy: { createdAt: 'asc' }, take: 1 },
          },
        },
      },
    })

    return rows.map((row) => ({
      analysis: this.toDomain(row),
      listing: toListingDomain(row.listing),
      imageUrl: row.listing.images[0]?.urlRemote,
    }))
  }

  async findAll(): Promise<AiAnalysis[]> {
    const analyses = await this.prisma.aiAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return analyses.map((a) => this.toDomain(a))
  }

  async update(analysis: AiAnalysis): Promise<AiAnalysis> {
    const updated = await this.prisma.aiAnalysis.update({
      where: { id: analysis.id },
      data: {
        estMinCents: analysis.estimatedMinPrice.getCents(),
        estMaxCents: analysis.estimatedMaxPrice.getCents(),
        marginCents: analysis.margin.getCents(),
        description: analysis.description,
        confidence: analysis.confidence,
        bestMatchSource: analysis.bestMatchSource,
        searchTerms: analysis.searchTerms ? JSON.parse(JSON.stringify(analysis.searchTerms)) : null,
        updatedAt: new Date(),
      },
    })
    return this.toDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.aiAnalysis.delete({ where: { id } })
  }

  private toDomain(raw: any): AiAnalysis {
    return AiAnalysis.fromPersistence({
      id: raw.id,
      listingId: raw.listingId,
      estimatedMinPrice: Money.fromCents(raw.estMinCents),
      estimatedMaxPrice: Money.fromCents(raw.estMaxCents),
      margin: Money.fromCents(raw.marginCents),
      description: raw.description,
      confidence: raw.confidence,
      provider: raw.provider,
      bestMatchSource: raw.bestMatchSource,
      searchTerms: raw.searchTerms ? (raw.searchTerms as any[]) : undefined,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    })
  }
}

