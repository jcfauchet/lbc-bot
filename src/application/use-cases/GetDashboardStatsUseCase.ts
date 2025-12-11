import { PrismaClient } from '@prisma/client'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { subDays, format } from 'date-fns'
import { fr } from 'date-fns/locale'

const COLORS = [
  "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-red-500", 
  "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500",
  "bg-orange-500", "bg-cyan-500"
]

export interface DailyStat {
  date: Date
  label: string
  total: number
  bySearch: Record<string, number>
}

export interface DashboardStats {
  dailyStats: DailyStat[]
  ignoredPercentage: number
  analyzedPercentage: number
  totalProcessed: number
  searchColors: Record<string, string>
  searchNames: string[]
  aiProviderStats: Array<{
    provider: string
    count: number
    percentage: number
  }>
  latestAlerts: Array<{
    id: string
    createdAt: Date
    status: string
    listing: {
      id: string
      title: string
      url: string
      priceCents: number
      images: Array<{
        urlRemote: string
      }>
      aiAnalysis: {
        estMinCents: number
        estMaxCents: number
        marginCents: number
      } | null
    }
  }>
}

export class GetDashboardStatsUseCase {
  constructor(private prisma: PrismaClient) {}

  async execute(): Promise<DashboardStats> {
    const now = new Date()
    const sevenDaysAgo = subDays(now, 7)

    const listings = await this.prisma.lbcProductListing.findMany({
      where: {
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      select: {
        createdAt: true,
        status: true,
        search: {
          select: {
            name: true
          }
        }
      },
    })

    const searchNames = Array.from(new Set(listings.map(l => l.search.name))).sort()
    const searchColors = searchNames.reduce((acc, name, index) => {
      acc[name] = COLORS[index % COLORS.length]
      return acc
    }, {} as Record<string, string>)

    const listingsByDayAndSearch = listings.reduce((acc, listing) => {
      const day = format(listing.createdAt, "yyyy-MM-dd")
      if (!acc[day]) {
        acc[day] = { total: 0, bySearch: {} }
      }
      const searchName = listing.search.name
      acc[day].bySearch[searchName] = (acc[day].bySearch[searchName] || 0) + 1
      acc[day].total += 1
      return acc
    }, {} as Record<string, { total: number, bySearch: Record<string, number> }>)

    const dailyStats: DailyStat[] = []
    for (let i = 6; i >= 0; i--) {
      const date = subDays(now, i)
      const dateKey = format(date, "yyyy-MM-dd")
      const dayData = listingsByDayAndSearch[dateKey] || { total: 0, bySearch: {} }
      
      dailyStats.push({
        date: date,
        label: format(date, "EEE d", { locale: fr }),
        total: dayData.total,
        bySearch: dayData.bySearch
      })
    }

    const total = listings.length
    const ignoredCount = listings.filter(l => l.status === ListingStatus.IGNORED).length
    const analyzedCount = listings.filter(l => 
      [ListingStatus.ANALYZED, ListingStatus.NOTIFIED, ListingStatus.ARCHIVED].includes(l.status as ListingStatus)
    ).length
    
    const processedTotal = ignoredCount + analyzedCount
    const ignoredPercentage = processedTotal > 0 ? Math.round((ignoredCount / processedTotal) * 100) : 0
    const analyzedPercentage = processedTotal > 0 ? Math.round((analyzedCount / processedTotal) * 100) : 0

    const providerGroups = await this.prisma.aiAnalysis.groupBy({
      by: ['provider'],
      _count: true,
    })

    const providerTotal = providerGroups.reduce((sum, p) => sum + p._count, 0)
    const aiProviderStats = providerGroups.map((p) => ({
      provider: p.provider,
      count: p._count,
      percentage: providerTotal > 0 ? Math.round((p._count / providerTotal) * 100) : 0,
    })).sort((a, b) => b.count - a.count)

    const latestAlerts = await this.prisma.notification.findMany({
      take: 10,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        listing: {
          include: {
            images: {
              take: 1
            },
            aiAnalysis: true
          }
        }
      }
    })

    return {
      dailyStats,
      ignoredPercentage,
      analyzedPercentage,
      totalProcessed: processedTotal,
      searchColors,
      searchNames,
      aiProviderStats,
      latestAlerts: latestAlerts.map(alert => ({
        id: alert.id,
        createdAt: alert.createdAt,
        status: alert.status,
        listing: {
          id: alert.listing.id,
          title: alert.listing.title,
          url: alert.listing.url,
          priceCents: alert.listing.priceCents,
          images: alert.listing.images.map(img => ({
            urlRemote: img.urlRemote
          })),
          aiAnalysis: alert.listing.aiAnalysis ? {
            estMinCents: alert.listing.aiAnalysis.estMinCents,
            estMaxCents: alert.listing.aiAnalysis.estMaxCents,
            marginCents: alert.listing.aiAnalysis.marginCents
          } : null
        }
      }))
    }
  }
}

