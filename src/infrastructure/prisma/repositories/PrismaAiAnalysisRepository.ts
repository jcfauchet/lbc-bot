import { PrismaClient } from '@prisma/client'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { Money } from '@/domain/value-objects/Money'

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
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    })
  }
}

