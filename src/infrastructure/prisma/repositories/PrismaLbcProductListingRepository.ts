import { PrismaClient } from '@prisma/client'
import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

export class PrismaLbcProductListingRepository implements IListingRepository {
  constructor(private prisma: PrismaClient) {}

  async save(listing: Listing): Promise<Listing> {
    const data = {
      lbcId: listing.lbcId,
      searchId: listing.searchId,
      url: listing.url,
      title: listing.title,
      priceCents: listing.price.getCents(),
      city: listing.city,
      region: listing.region,
      publishedAt: listing.publishedAt,
      status: listing.status,
    }

    const created = await this.prisma.lbcProductListing.create({ data })
    return this.toDomain(created)
  }

  async findById(id: string): Promise<Listing | null> {
    const listing = await this.prisma.lbcProductListing.findUnique({ where: { id } })
    return listing ? this.toDomain(listing) : null
  }

  async findByLbcId(lbcId: string): Promise<Listing | null> {
    const listing = await this.prisma.lbcProductListing.findUnique({ where: { lbcId } })
    return listing ? this.toDomain(listing) : null
  }

  async findBySearchId(searchId: string): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { searchId },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => this.toDomain(l))
  }

  async findByStatus(status: ListingStatus): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => this.toDomain(l))
  }

  async findWithoutAiAnalysis(): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      where: { aiAnalysis: null },
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => this.toDomain(l))
  }

  async findAll(): Promise<Listing[]> {
    const listings = await this.prisma.lbcProductListing.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return listings.map((l) => this.toDomain(l))
  }

  async update(listing: Listing): Promise<Listing> {
    const updated = await this.prisma.lbcProductListing.update({
      where: { id: listing.id },
      data: {
        status: listing.status,
        updatedAt: new Date(),
      },
    })
    return this.toDomain(updated)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.lbcProductListing.delete({ where: { id } })
  }

  private toDomain(raw: any): Listing {
    return Listing.fromPersistence({
      id: raw.id,
      lbcId: raw.lbcId,
      searchId: raw.searchId,
      url: raw.url,
      title: raw.title,
      price: Money.fromCents(raw.priceCents),
      city: raw.city,
      region: raw.region,
      publishedAt: raw.publishedAt,
      status: raw.status as ListingStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    })
  }
}

