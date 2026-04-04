import { PrismaClient } from '@prisma/client'
import { ListingFeedback } from '@/domain/entities/ListingFeedback'
import { IFeedbackRepository, SimilarFeedback } from '@/domain/repositories/IFeedbackRepository'

export class PrismaFeedbackRepository implements IFeedbackRepository {
  constructor(private prisma: PrismaClient) {}

  async save(feedback: ListingFeedback, embedding?: number[]): Promise<ListingFeedback> {
    if (embedding) {
      const vectorLiteral = `[${embedding.join(',')}]`
      await this.prisma.$executeRaw`
        INSERT INTO "listing_feedbacks" ("id", "listingId", "isGood", "comment", "embeddingText", "embedding", "createdAt")
        VALUES (
          ${feedback.id},
          ${feedback.listingId},
          ${feedback.isGood},
          ${feedback.comment ?? null},
          ${feedback.embeddingText ?? null},
          ${vectorLiteral}::vector,
          ${feedback.createdAt}
        )
      `
    } else {
      await this.prisma.listingFeedback.create({
        data: {
          id: feedback.id,
          listingId: feedback.listingId,
          isGood: feedback.isGood,
          comment: feedback.comment ?? null,
          embeddingText: feedback.embeddingText ?? null,
          createdAt: feedback.createdAt,
        },
      })
    }

    return feedback
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(',')}]`
    await this.prisma.$executeRaw`
      UPDATE "listing_feedbacks" SET "embedding" = ${vectorLiteral}::vector WHERE "id" = ${id}
    `
  }

  async updateComment(id: string, comment: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "listing_feedbacks" SET "comment" = ${comment} WHERE "id" = ${id}
    `
  }

  async findSimilar(embedding: number[], limit: number): Promise<SimilarFeedback[]> {
    const vectorLiteral = `[${embedding.join(',')}]`

    const rows = await this.prisma.$queryRaw<Array<{
      listingTitle: string
      priceCents: number
      isGood: boolean
      comment: string | null
      aiDescription: string | null
      similarity: number
    }>>`
      SELECT
        p.title AS "listingTitle",
        p."priceCents",
        f."isGood",
        f."comment",
        a.description AS "aiDescription",
        1 - (f.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM "listing_feedbacks" f
      JOIN "lbc_product_listings" p ON p.id = f."listingId"
      LEFT JOIN "ai_analyses" a ON a."listingId" = f."listingId"
      WHERE f.embedding IS NOT NULL
      ORDER BY f.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `

    return rows.map((row) => ({
      listingTitle: row.listingTitle,
      priceCents: row.priceCents,
      isGood: row.isGood,
      comment: row.comment ?? undefined,
      aiDescription: row.aiDescription ?? undefined,
      similarity: Number(row.similarity),
    }))
  }

  async findByListingId(listingId: string): Promise<ListingFeedback | null> {
    const row = await this.prisma.listingFeedback.findFirst({
      where: { listingId },
    })
    if (!row) return null

    return ListingFeedback.create({
      id: row.id,
      listingId: row.listingId,
      isGood: row.isGood,
      comment: row.comment ?? undefined,
      embeddingText: row.embeddingText ?? undefined,
      createdAt: row.createdAt,
    })
  }
}
