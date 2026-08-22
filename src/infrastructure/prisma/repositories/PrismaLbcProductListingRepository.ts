import { PrismaClient } from '@prisma/client'
import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { toListingDomain } from '@/infrastructure/prisma/mappers/listingMapper'

export class PrismaLbcProductListingRepository implements IListingRepository {
  constructor(private prisma: PrismaClient) {}

  async save(listing: Listing): Promise<Listing> {
    const data = {
      lbcId: listing.lbcId,
      searchId: listing.searchId,
      url: listing.url,
      title: listing.title,
      description: listing.description,
      priceCents: listing.price.getCents(),
      city: listing.city,
      region: listing.region,
      publishedAt: listing.publishedAt,
      status: listing.status,
      triageScore: listing.triageScore,
    }

    const created = await this.prisma.lbcProductListing.create({ data })
    return toListingDomain(created)
  }

  async saveMany(listings: Listing[]): Promise<Listing[]> {
    if (listings.length === 0) return []

    const created = await this.prisma.lbcProductListing.createManyAndReturn({
      data: listings.map((listing) => ({
        lbcId: listing.lbcId,
        searchId: listing.searchId,
        url: listing.url,
        title: listing.title,
        description: listing.description,
        priceCents: listing.price.getCents(),
        city: listing.city,
        region: listing.region,
        publishedAt: listing.publishedAt,
        status: listing.status,
        triageScore: listing.triageScore,
      })),
    })

    return created.map(toListingDomain)
  }

  async findById(id: string): Promise<Listing | null> {
    const listing = await this.prisma.lbcProductListing.findUnique({ where: { id } })
    return listing ? toListingDomain(listing) : null
  }

  async findByLbcId(lbcId: string): Promise<Listing | null> {
    const listing = await this.prisma.lbcProductListing.findUnique({ where: { lbcId } })
    return listing ? toListingDomain(listing) : null
  }

  async findExistingLbcIds(lbcIds: string[]): Promise<Set<string>> {
    if (lbcIds.length === 0) return new Set()

    const rows = await this.prisma.lbcProductListing.findMany({
      where: { lbcId: { in: lbcIds } },
      select: { lbcId: true },
    })

    return new Set(rows.map((row) => row.lbcId))
  }

  async findBySearchId(searchId: string): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { searchId },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => toListingDomain(l))
  }

  async findByStatus(status: ListingStatus): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => toListingDomain(l))
  }

  async findWithoutAiAnalysis(): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { 
        aiAnalysis: null,
        status: { 
          notIn: [ListingStatus.IGNORED, ListingStatus.ANALYZING]
        }
      },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => toListingDomain(l))
  }

  async findAll(): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => toListingDomain(l))
  }

  async update(listing: Listing): Promise<Listing> {
    const updated = await this.prisma.lbcProductListing.update({
      where: { id: listing.id },
      data: {
        status: listing.status,
        ignoreReason: listing.ignoreReason,
        triageScore: listing.triageScore,
        updatedAt: new Date(),
      },
    })
    return toListingDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.lbcProductListing.delete({ where: { id } })
  }

  async deleteIgnoredOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    
    const result = await this.prisma.lbcProductListing.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
        status: {
          equals: ListingStatus.IGNORED
        }
      },
    })
    
    return result.count
  }

  async ignoreTriagedOlderThan(days: number, reason: string): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    // Single bulk UPDATE: the backlog can hold thousands of stale rows, so
    // expiring them one by one would blow the serverless time budget.
    const result = await this.prisma.lbcProductListing.updateMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { equals: ListingStatus.TRIAGED },
      },
      data: {
        status: ListingStatus.IGNORED,
        ignoreReason: reason,
        updatedAt: new Date(),
      },
    })

    return result.count
  }
}

