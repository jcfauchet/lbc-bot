import { PrismaClient } from '@prisma/client'
import type {
  IReferenceRepository, ImageToEmbed, ListingToCheck, NewPhotoReference, PendingAlert,
  PhotoReferenceSummary, RecordedMatch, ReferenceCandidate,
} from '@/domain/repositories/IReferenceRepository'

const toVector = (embedding: number[]) => `[${embedding.join(',')}]`

type CandidateRow = {
  referenceId: string; name: string; note: string | null; maxPriceCents: number | null
  similarity: number; imageUrls: string[]
}
const toCandidate = (row: CandidateRow): ReferenceCandidate => ({
  referenceId: row.referenceId, name: row.name, note: row.note, maxPriceCents: row.maxPriceCents,
  similarity: Number(row.similarity), imageUrls: row.imageUrls,
})

export class PrismaReferenceRepository implements IReferenceRepository {
  constructor(private prisma: PrismaClient) {}

  async hasActiveReferences(): Promise<boolean> {
    return (await this.prisma.photoReference.count({ where: { isActive: true } })) > 0
  }

  async create(reference: NewPhotoReference, imageUrls: string[]) {
    const created = await this.prisma.photoReference.create({
      data: { ...reference, images: { create: imageUrls.map((urlRemote) => ({ urlRemote })) } },
      include: { images: { orderBy: { createdAt: 'asc' } } },
    })
    return { id: created.id, images: created.images.map((i) => ({ id: i.id, url: i.urlRemote })) }
  }

  async list(): Promise<PhotoReferenceSummary[]> {
    const rows = await this.prisma.photoReference.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        images: { orderBy: { createdAt: 'asc' } },
        matches: { where: { confirmed: true }, include: { listing: { select: { url: true } } }, orderBy: { createdAt: 'desc' } },
      },
    })
    return rows.map((r) => ({
      id: r.id, name: r.name, note: r.note, maxPriceCents: r.maxPriceCents, isActive: r.isActive,
      createdAt: r.createdAt, imageUrls: r.images.map((i) => i.urlRemote),
      matchCount: r.matches.length, matchedListingUrls: r.matches.map((m) => m.listing.url),
    }))
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.prisma.photoReference.update({ where: { id }, data: { isActive } })
  }

  async findReferenceImagesMissingEmbedding(limit: number): Promise<ImageToEmbed[]> {
    return this.prisma.$queryRaw<ImageToEmbed[]>`
      SELECT "id", "urlRemote" AS "url" FROM "reference_images"
      WHERE "embedding" IS NULL ORDER BY "createdAt" ASC LIMIT ${limit}
    `
  }

  async setReferenceImageEmbedding(imageId: string, embedding: number[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "reference_images" SET "embedding" = ${toVector(embedding)}::vector WHERE "id" = ${imageId}
    `
  }

  async findListingsToCheck(limit: number, maxAgeDays: number): Promise<ListingToCheck[]> {
    const listings = await this.prisma.$queryRaw<Array<{ id: string; title: string; priceCents: number }>>`
      SELECT p."id", p."title", p."priceCents" FROM "lbc_product_listings" p
      WHERE p."referenceCheckedAt" IS NULL
        AND p."createdAt" >= NOW() - make_interval(days => ${maxAgeDays})
        AND NOT EXISTS (SELECT 1 FROM "listing_feedbacks" f WHERE f."listingId" = p."id" AND f."isGood" = false)
      ORDER BY p."createdAt" DESC LIMIT ${limit}
    `
    return this.attachImages(listings)
  }

  async setListingImageEmbedding(imageId: string, embedding: number[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "listing_images" SET "embedding" = ${toVector(embedding)}::vector WHERE "id" = ${imageId}
    `
  }

  async findCandidates(listingId: string, minSimilarity: number, limit: number): Promise<ReferenceCandidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT r."id" AS "referenceId", r."name", r."note", r."maxPriceCents",
             MAX(1 - (li."embedding" <=> ri."embedding")) AS "similarity",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "listing_images" li
      JOIN "reference_images" ri ON ri."embedding" IS NOT NULL
      JOIN "photo_references" r ON r."id" = ri."referenceId" AND r."isActive"
      WHERE li."listingId" = ${listingId} AND li."embedding" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = ${listingId})
      GROUP BY r."id"
      HAVING MAX(1 - (li."embedding" <=> ri."embedding")) >= ${minSimilarity}
      ORDER BY "similarity" DESC
      LIMIT ${limit}
    `
    return rows.map(toCandidate)
  }

  async findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number, limit: number) {
    const rows = await this.prisma.$queryRaw<Array<CandidateRow & { listingId: string; title: string; priceCents: number }>>`
      SELECT p."id" AS "listingId", p."title", p."priceCents",
             r."id" AS "referenceId", r."name", r."note", r."maxPriceCents",
             MAX(1 - (li."embedding" <=> ri."embedding")) AS "similarity",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "lbc_product_listings" p
      JOIN "listing_images" li ON li."listingId" = p."id" AND li."embedding" IS NOT NULL
      JOIN "reference_images" ri ON ri."referenceId" = ${referenceId} AND ri."embedding" IS NOT NULL
      JOIN "photo_references" r ON r."id" = ri."referenceId" AND r."isActive"
      WHERE p."createdAt" >= NOW() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM "listing_feedbacks" f WHERE f."listingId" = p."id" AND f."isGood" = false)
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
      GROUP BY p."id", r."id"
      HAVING MAX(1 - (li."embedding" <=> ri."embedding")) >= ${minSimilarity}
      ORDER BY "similarity" DESC
      LIMIT ${limit}
    `
    const listings = await this.attachImages(rows.map((r) => ({ id: r.listingId, title: r.title, priceCents: r.priceCents })))
    return rows.map((row, i) => ({ listing: listings[i], candidate: toCandidate(row) }))
  }

  async findReferencesToBackfill(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r."id" FROM "photo_references" r
      WHERE r."isActive" AND r."backfilledAt" IS NULL
        AND EXISTS (SELECT 1 FROM "reference_images" ri WHERE ri."referenceId" = r."id")
        AND NOT EXISTS (SELECT 1 FROM "reference_images" ri WHERE ri."referenceId" = r."id" AND ri."embedding" IS NULL)
      ORDER BY r."createdAt" ASC
    `
    return rows.map((r) => r.id)
  }

  async markBackfilled(referenceId: string): Promise<void> {
    await this.prisma.photoReference.update({ where: { id: referenceId }, data: { backfilledAt: new Date() } })
  }

  async recordMatch(match: RecordedMatch): Promise<void> {
    // The unique (referenceId, listingId) pair makes a concurrent double-judgement a no-op.
    await this.prisma.referenceMatch.upsert({
      where: { referenceId_listingId: { referenceId: match.referenceId, listingId: match.listingId } },
      create: match,
      update: {},
    })
  }

  async markListingChecked(listingId: string): Promise<void> {
    await this.prisma.lbcProductListing.update({ where: { id: listingId }, data: { referenceCheckedAt: new Date() } })
  }

  async findPendingAlerts(): Promise<PendingAlert[]> {
    const rows = await this.prisma.referenceMatch.findMany({
      where: { confirmed: true, notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        reference: { include: { images: { orderBy: { createdAt: 'asc' }, take: 1 } } },
        listing: { include: { images: { orderBy: { createdAt: 'asc' }, take: 1 } } },
      },
    })
    return rows.map((m) => ({
      matchId: m.id,
      referenceName: m.reference.name,
      referenceImageUrl: m.reference.images[0]?.urlRemote ?? null,
      listingId: m.listingId,
      listingTitle: m.listing.title,
      listingUrl: m.listing.url,
      priceCents: m.listing.priceCents,
      city: m.listing.city,
      listingImageUrl: m.listing.images[0]?.urlRemote ?? null,
      reason: m.reason,
    }))
  }

  async markNotified(matchId: string): Promise<void> {
    await this.prisma.referenceMatch.update({ where: { id: matchId }, data: { notifiedAt: new Date() } })
  }

  private async attachImages(listings: Array<{ id: string; title: string; priceCents: number }>): Promise<ListingToCheck[]> {
    if (listings.length === 0) return []
    const ids = listings.map((l) => l.id)
    const images = await this.prisma.$queryRaw<Array<{ id: string; listingId: string; url: string; hasEmbedding: boolean }>>`
      SELECT "id", "listingId", "urlRemote" AS "url", ("embedding" IS NOT NULL) AS "hasEmbedding"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "listingId" ORDER BY "createdAt", "id") AS rn
        FROM "listing_images" WHERE "listingId" = ANY(${ids})
      ) ranked
      WHERE rn <= 3
      ORDER BY "listingId", rn
    `
    return listings.map((l) => ({
      ...l,
      images: images.filter((i) => i.listingId === l.id).map(({ id, url, hasEmbedding }) => ({ id, url, hasEmbedding })),
    }))
  }
}
