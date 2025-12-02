import { PrismaClient } from '@prisma/client'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface NonNotifiedListing {
  id: string
  lbcId: string
  url: string
  title: string
  priceCents: number
  city: string | null
  region: string | null
  publishedAt: Date | null
  status: string
  ignoreReason: string | null
  nonNotificationReason: string
  createdAt: Date
  updatedAt: Date
  search: {
    id: string
    name: string
  }
  images: Array<{
    id: string
    urlRemote: string
  }>
  aiAnalysis: {
    id: string
    estMinCents: number
    estMaxCents: number
    marginCents: number
    description: string
    confidence: number | null
    provider: string
    bestMatchSource: string | null
    createdAt: Date
  } | null
  notifications: Array<{
    id: string
    status: string
    createdAt: Date
  }>
}

export class GetNonNotifiedListingsUseCase {
  constructor(
    private prisma: PrismaClient,
    private minMarginInEur: number
  ) {}

  private getNonNotificationReason(listing: {
    status: string
    ignoreReason: string | null
    aiAnalysis: {
      confidence: number | null
      marginCents: number
    } | null
    notifications: Array<{ status: string }>
  }): string {
    const minMarginCents = this.minMarginInEur * 100
    const hasSentNotification = listing.notifications.some((n) => n.status === 'sent')

    if (hasSentNotification) {
      return 'Déjà notifié'
    }

    if (listing.ignoreReason) {
      return listing.ignoreReason
    }

    if (listing.status === ListingStatus.NEW) {
      return "En attente d'analyse"
    }

    if (listing.status === ListingStatus.ANALYZING) {
      return 'Analyse en cours...'
    }

    if (listing.status === ListingStatus.IGNORED) {
      if (listing.aiAnalysis) {
        if (listing.aiAnalysis.confidence !== null && listing.aiAnalysis.confidence < 0.8) {
          return `Confiance trop faible (${Math.round(listing.aiAnalysis.confidence * 100)}%)`
        }
        if (listing.aiAnalysis.marginCents < 0) {
          return 'Marge négative (prix trop élevé)'
        }
        if (listing.aiAnalysis.marginCents < minMarginCents) {
          return `Marge insuffisante (${(listing.aiAnalysis.marginCents / 100).toFixed(0)}€ < ${this.minMarginInEur}€ minimum)`
        }
        return 'Ignoré après analyse'
      }
      return 'Ignoré avant analyse (pas prometteur, pas de designer, etc.)'
    }

    if (listing.status === ListingStatus.ANALYZED) {
      if (listing.aiAnalysis) {
        if (listing.aiAnalysis.marginCents < minMarginCents) {
          return `Marge insuffisante (${(listing.aiAnalysis.marginCents / 100).toFixed(0)}€ < ${this.minMarginInEur}€ minimum)`
        }
        return 'Analysé, en attente de notification'
      }
      return "Analysé mais pas d'analyse trouvée"
    }

    return 'Statut inconnu'
  }

  async execute(limit: number = 100): Promise<NonNotifiedListing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      take: limit,
      where: {
        status: {
          notIn: [ListingStatus.NOTIFIED, ListingStatus.ARCHIVED]
        },
        notifications: {
          none: {
            status: 'sent'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        search: {
          select: {
            id: true,
            name: true
          }
        },
        images: {
          select: {
            id: true,
            urlRemote: true
          },
          orderBy: {
            createdAt: 'asc'
          },
          take: 1
        },
        aiAnalysis: {
          select: {
            id: true,
            estMinCents: true,
            estMaxCents: true,
            marginCents: true,
            description: true,
            confidence: true,
            provider: true,
            bestMatchSource: true,
            createdAt: true
          }
        },
        notifications: {
          select: {
            id: true,
            status: true,
            createdAt: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    })

    return listings.map(listing => {
      const listingData = {
        id: listing.id,
        lbcId: listing.lbcId,
        url: listing.url,
        title: listing.title,
        priceCents: listing.priceCents,
        city: listing.city,
        region: listing.region,
        publishedAt: listing.publishedAt,
        status: listing.status,
        ignoreReason: listing.ignoreReason,
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
        search: {
          id: listing.search.id,
          name: listing.search.name
        },
        images: listing.images.map(img => ({
          id: img.id,
          urlRemote: img.urlRemote
        })),
        aiAnalysis: listing.aiAnalysis ? {
          id: listing.aiAnalysis.id,
          estMinCents: listing.aiAnalysis.estMinCents,
          estMaxCents: listing.aiAnalysis.estMaxCents,
          marginCents: listing.aiAnalysis.marginCents,
          description: listing.aiAnalysis.description,
          confidence: listing.aiAnalysis.confidence,
          provider: listing.aiAnalysis.provider,
          bestMatchSource: listing.aiAnalysis.bestMatchSource,
          createdAt: listing.aiAnalysis.createdAt
        } : null,
        notifications: listing.notifications.map(notif => ({
          id: notif.id,
          status: notif.status,
          createdAt: notif.createdAt
        }))
      }

      return {
        ...listingData,
        nonNotificationReason: this.getNonNotificationReason({
          status: listing.status,
          ignoreReason: listing.ignoreReason,
          aiAnalysis: listing.aiAnalysis,
          notifications: listing.notifications
        })
      }
    })
  }
}

