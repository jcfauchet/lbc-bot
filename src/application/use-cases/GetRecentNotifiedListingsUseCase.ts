import { PrismaClient } from '@prisma/client'
import { subDays } from 'date-fns'

export interface NotifiedListingForFeedback {
  notificationId: string
  notifiedAt: Date
  listing: {
    id: string
    title: string
    url: string
    priceCents: number
    imageUrl: string | null
    aiAnalysis: {
      estMinCents: number
      estMaxCents: number
      marginCents: number
    } | null
  }
}

/**
 * Lists the listings notified over the last `days`, most recent first and
 * de-duplicated by listing, so a single page can collect feedback on every
 * recently-emailed deal without bouncing back to the inbox.
 */
export class GetRecentNotifiedListingsUseCase {
  constructor(private prisma: PrismaClient) {}

  async execute(days = 14): Promise<NotifiedListingForFeedback[]> {
    const since = subDays(new Date(), days)

    const notifications = await this.prisma.notification.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        listing: {
          include: {
            images: { take: 1 },
            aiAnalysis: true,
          },
        },
      },
    })

    const seen = new Set<string>()
    const result: NotifiedListingForFeedback[] = []

    for (const n of notifications) {
      if (seen.has(n.listing.id)) continue
      seen.add(n.listing.id)
      result.push({
        notificationId: n.id,
        notifiedAt: n.createdAt,
        listing: {
          id: n.listing.id,
          title: n.listing.title,
          url: n.listing.url,
          priceCents: n.listing.priceCents,
          imageUrl: n.listing.images[0]?.urlRemote ?? null,
          aiAnalysis: n.listing.aiAnalysis
            ? {
                estMinCents: n.listing.aiAnalysis.estMinCents,
                estMaxCents: n.listing.aiAnalysis.estMaxCents,
                marginCents: n.listing.aiAnalysis.marginCents,
              }
            : null,
        },
      })
    }

    return result
  }
}
