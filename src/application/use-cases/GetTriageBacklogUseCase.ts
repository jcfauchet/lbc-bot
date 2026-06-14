import { PrismaClient } from '@prisma/client'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface BacklogListing {
  id: string
  title: string
  url: string
  priceCents: number
  imageUrl: string | null
  triageScore: number | null
  city: string | null
  createdAt: Date
}

/**
 * Lists the listings stuck in `triaged` (passed triage but never price-analysed,
 * because comp only drains a handful per day). Ordered exactly as comp would
 * pick them — highest triage score first, then most recent — so the manual
 * qualification page surfaces the most promising ones at the top.
 */
export class GetTriageBacklogUseCase {
  constructor(private prisma: PrismaClient) {}

  async execute({ minScore = 0, limit = 300 }: { minScore?: number; limit?: number } = {}): Promise<BacklogListing[]> {
    const rows = await this.prisma.lbcProductListing.findMany({
      where: { status: ListingStatus.TRIAGED, triageScore: { gte: minScore } },
      orderBy: [{ triageScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { images: { take: 1, orderBy: { createdAt: 'asc' } } },
    })

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      priceCents: r.priceCents,
      imageUrl: r.images[0]?.urlRemote ?? null,
      triageScore: r.triageScore,
      city: r.city,
      createdAt: r.createdAt,
    }))
  }
}
