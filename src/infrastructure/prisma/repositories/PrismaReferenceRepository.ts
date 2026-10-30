import { Prisma, PrismaClient } from '@prisma/client'
import type {
  AuctionFundStats, AuctionLotSummary, CandidateGates, IReferenceRepository, ImageToEmbed, ListingToCheck,
  NewAuctionLot, NewPhotoReference, PendingAlert, PhotoReferenceSummary, RecordedMatch, ReferenceCandidate,
  ReferenceSource,
} from '@/domain/repositories/IReferenceRepository'

const toVector = (embedding: number[]) => `[${embedding.join(',')}]`

/** True when one of reference r's keywords appears in listing p's title or description. */
const KEYWORD_HIT_SQL = Prisma.sql`EXISTS (
  SELECT 1 FROM unnest(r."keywords") AS kw
  WHERE p."title" ILIKE '%' || kw || '%' OR p."description" ILIKE '%' || kw || '%'
)`

type CandidateRow = {
  referenceId: string; name: string; note: string | null; maxPriceCents: number | null
  similarity: number; textHit: boolean; imageUrls: string[]
}
type AuctionCandidateRow = CandidateRow & AuctionLotSummary
const toCandidate = (row: CandidateRow): ReferenceCandidate => ({
  referenceId: row.referenceId, name: row.name, note: row.note, maxPriceCents: row.maxPriceCents,
  similarity: Number(row.similarity), textHit: row.textHit, imageUrls: row.imageUrls,
  source: 'MANUAL', auction: null,
})
const toAuctionCandidate = (row: AuctionCandidateRow): ReferenceCandidate => ({
  ...toCandidate(row),
  source: 'ARTCURIAL',
  auction: {
    house: row.house, saleRef: row.saleRef, lotRef: row.lotRef, lotUrl: row.lotUrl, saleName: row.saleName,
    soldAt: row.soldAt, title: row.title, artist: row.artist, hammerCents: row.hammerCents,
    quantity: row.quantity, hammerPerUnitCents: row.hammerPerUnitCents,
  },
})
const toAuctionSummary = (lot: AuctionLotSummary): AuctionLotSummary => ({
  house: lot.house, saleRef: lot.saleRef, lotRef: lot.lotRef, lotUrl: lot.lotUrl, saleName: lot.saleName,
  soldAt: lot.soldAt, title: lot.title, artist: lot.artist, hammerCents: lot.hammerCents,
  quantity: lot.quantity, hammerPerUnitCents: lot.hammerPerUnitCents,
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
      where: { source: 'MANUAL' },
      orderBy: { createdAt: 'desc' },
      include: {
        images: { orderBy: { createdAt: 'asc' } },
        matches: { where: { confirmed: true }, include: { listing: { select: { url: true } } }, orderBy: { createdAt: 'desc' } },
      },
    })
    return rows.map((r) => ({
      id: r.id, name: r.name, note: r.note, maxPriceCents: r.maxPriceCents, isActive: r.isActive,
      createdAt: r.createdAt, keywords: r.keywords, imageUrls: r.images.map((i) => i.urlRemote),
      matchCount: r.matches.length, matchedListingUrls: r.matches.map((m) => m.listing.url),
    }))
  }

  async setActive(id: string, isActive: boolean): Promise<boolean> {
    const { count } = await this.prisma.photoReference.updateMany({ where: { id }, data: { isActive } })
    return count > 0
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

  /**
   * Similarity is the best (listing photo, reference photo) pair, 0 when the ad has
   * no embedded photo yet. Manual references: a keyword hit qualifies on its own, never capped.
   * Auction lots: a keyword hit also needs `keywordMinSimilarity`, at most `auctionLimit` of them.
   */
  async findCandidates(listingId: string, gates: CandidateGates): Promise<ReferenceCandidate[]> {
    const manual = await this.findManualCandidates(listingId, gates.minSimilarity)
    if (!gates.includeAuction) return manual
    return [...manual, ...(await this.findAuctionCandidates(listingId, gates))]
  }

  private async findManualCandidates(listingId: string, minSimilarity: number): Promise<ReferenceCandidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT r."id" AS "referenceId", r."name", r."note", r."maxPriceCents", 'MANUAL' AS "source",
             COALESCE(MAX(1 - (li."embedding" <=> ri."embedding")), 0) AS "similarity",
             ${KEYWORD_HIT_SQL} AS "textHit",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "lbc_product_listings" p
      CROSS JOIN "photo_references" r
      JOIN "reference_images" ri ON ri."referenceId" = r."id" AND ri."embedding" IS NOT NULL
      LEFT JOIN "listing_images" li ON li."listingId" = p."id" AND li."embedding" IS NOT NULL
      WHERE p."id" = ${listingId} AND r."isActive" AND r."source" = 'MANUAL'
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
      GROUP BY p."id", r."id"
      HAVING COALESCE(MAX(1 - (li."embedding" <=> ri."embedding")), 0) >= ${minSimilarity}
          OR ${KEYWORD_HIT_SQL}
      ORDER BY "textHit" DESC, "similarity" DESC
    `
    return rows.map(toCandidate)
  }

  /** kNN per listing photo (LIMIT 50 so the HNSW index serves it), then only references that are auction lots. */
  private async findAuctionCandidates(listingId: string, gates: CandidateGates): Promise<ReferenceCandidate[]> {
    const rows = await this.prisma.$queryRaw<AuctionCandidateRow[]>`
      WITH nn AS (
        SELECT ri."referenceId", MAX(1 - (li."embedding" <=> ri."embedding")) AS sim
        FROM "listing_images" li
        CROSS JOIN LATERAL (
          SELECT ri."referenceId", ri."embedding" FROM "reference_images" ri
          WHERE ri."embedding" IS NOT NULL
          ORDER BY ri."embedding" <=> li."embedding" LIMIT 50
        ) ri
        WHERE li."listingId" = ${listingId} AND li."embedding" IS NOT NULL
        GROUP BY ri."referenceId"
      )
      SELECT r."id" AS "referenceId", r."name", r."note", r."maxPriceCents", 'ARTCURIAL' AS "source",
             COALESCE(nn.sim, 0) AS "similarity", ${KEYWORD_HIT_SQL} AS "textHit",
             (SELECT ARRAY_AGG("urlRemote" ORDER BY "createdAt", "id") FROM "reference_images" WHERE "referenceId" = r."id") AS "imageUrls",
             a."house", a."saleRef", a."lotRef", a."lotUrl", a."saleName", a."soldAt", a."title", a."artist",
             a."hammerCents", a."quantity", a."hammerPerUnitCents"
      FROM "lbc_product_listings" p
      CROSS JOIN "photo_references" r
      JOIN "auction_lots" a ON a."referenceId" = r."id"
      LEFT JOIN nn ON nn."referenceId" = r."id"
      WHERE p."id" = ${listingId} AND r."isActive" AND r."source" = 'ARTCURIAL'
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
        AND (COALESCE(nn.sim, 0) >= ${gates.minSimilarity} OR (${KEYWORD_HIT_SQL} AND COALESCE(nn.sim, 0) >= ${gates.keywordMinSimilarity}))
      ORDER BY "textHit" DESC, "similarity" DESC
      LIMIT ${gates.auctionLimit}
    `
    return rows.map(toAuctionCandidate)
  }

  async findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number, limit: number) {
    const rows = await this.prisma.$queryRaw<Array<CandidateRow & { listingId: string; title: string; priceCents: number }>>`
      SELECT p."id" AS "listingId", p."title", p."priceCents",
             r."id" AS "referenceId", r."name", r."note", r."maxPriceCents",
             COALESCE(MAX(1 - (li."embedding" <=> ri."embedding")), 0) AS "similarity",
             ${KEYWORD_HIT_SQL} AS "textHit",
             ARRAY_AGG(DISTINCT ri."urlRemote") AS "imageUrls"
      FROM "lbc_product_listings" p
      CROSS JOIN "photo_references" r
      JOIN "reference_images" ri ON ri."referenceId" = r."id" AND ri."embedding" IS NOT NULL
      LEFT JOIN "listing_images" li ON li."listingId" = p."id" AND li."embedding" IS NOT NULL
      WHERE r."id" = ${referenceId} AND r."isActive" AND r."source" = 'MANUAL'
        AND p."createdAt" >= NOW() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM "listing_feedbacks" f WHERE f."listingId" = p."id" AND f."isGood" = false)
        AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
      GROUP BY p."id", r."id"
      HAVING COALESCE(MAX(1 - (li."embedding" <=> ri."embedding")), 0) >= ${minSimilarity}
          OR ${KEYWORD_HIT_SQL}
      ORDER BY "textHit" DESC, "similarity" DESC
      LIMIT ${limit}
    `
    const listings = await this.attachImages(rows.map((r) => ({ id: r.listingId, title: r.title, priceCents: r.priceCents })))
    return rows.map((row, i) => ({ listing: listings[i], candidate: toCandidate(row) }))
  }

  async findReferencesToBackfill(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r."id" FROM "photo_references" r
      WHERE r."isActive" AND r."backfilledAt" IS NULL AND r."source" = 'MANUAL'
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
        reference: { include: { images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 }, auctionLot: true } },
        listing: { include: { images: { orderBy: { position: 'asc' }, take: 1 } } },
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
      source: m.reference.source as ReferenceSource,
      similarity: m.similarity,
      auction: m.reference.auctionLot ? toAuctionSummary(m.reference.auctionLot) : null,
    }))
  }

  async markNotified(matchId: string): Promise<void> {
    await this.prisma.referenceMatch.update({ where: { id: matchId }, data: { notifiedAt: new Date() } })
  }

  async createAuctionLot(input: NewAuctionLot): Promise<{ id: string; images: ImageToEmbed[] } | null> {
    const { house, saleRef, lotRef } = input.lot
    const existing = await this.prisma.auctionLot.findUnique({
      where: { house_saleRef_lotRef: { house, saleRef, lotRef } },
      select: { id: true },
    })
    if (existing) return null
    const created = await this.prisma.photoReference.create({
      data: {
        name: input.name,
        note: input.note,
        keywords: input.keywords,
        maxPriceCents: null,
        source: 'ARTCURIAL',
        backfilledAt: new Date(),
        auctionLot: { create: input.lot },
        images: { create: input.imageUrls.map((urlRemote) => ({ urlRemote })) },
      },
      include: { images: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    })
    return { id: created.id, images: created.images.map((i) => ({ id: i.id, url: i.urlRemote })) }
  }

  async countAuctionVerificationsSince(since: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "reference_matches" m
      JOIN "photo_references" r ON r."id" = m."referenceId"
      WHERE r."source" = 'ARTCURIAL' AND m."createdAt" >= ${since}
    `
    return Number(row?.count ?? 0)
  }

  async auctionFundStats(): Promise<AuctionFundStats> {
    const lots = await this.prisma.photoReference.count({ where: { source: 'ARTCURIAL' } })
    const [images] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "reference_images" ri
      JOIN "photo_references" r ON r."id" = ri."referenceId"
      WHERE r."source" = 'ARTCURIAL'
    `
    const [embedded] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "reference_images" ri
      JOIN "photo_references" r ON r."id" = ri."referenceId"
      WHERE r."source" = 'ARTCURIAL' AND ri."embedding" IS NOT NULL
    `
    return { lots, images: Number(images?.count ?? 0), embedded: Number(embedded?.count ?? 0) }
  }

  private async attachImages(listings: Array<{ id: string; title: string; priceCents: number }>): Promise<ListingToCheck[]> {
    if (listings.length === 0) return []
    const ids = listings.map((l) => l.id)
    const images = await this.prisma.$queryRaw<Array<{ id: string; listingId: string; url: string; hasEmbedding: boolean }>>`
      SELECT "id", "listingId", "urlRemote" AS "url", ("embedding" IS NOT NULL) AS "hasEmbedding"
      FROM "listing_images" WHERE "listingId" = ANY(${ids})
      ORDER BY "listingId", "position", "createdAt", "id"
    `
    return listings.map((l) => ({
      ...l,
      images: images.filter((i) => i.listingId === l.id).map(({ id, url, hasEmbedding }) => ({ id, url, hasEmbedding })),
    }))
  }
}
