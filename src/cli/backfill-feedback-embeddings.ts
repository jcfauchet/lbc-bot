#!/usr/bin/env node
/**
 * Embeds feedback rows saved without a vector. The feedback route embeds on a
 * best-effort basis, so every vote cast while the OpenAI key was failing (all of
 * June 2026) was invisible to the similar-feedback skip in the comp stage.
 * Idempotent: only rows with a NULL embedding are touched.
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { EmbeddingService } from '@/infrastructure/ai/EmbeddingService'
import { PrismaFeedbackRepository } from '@/infrastructure/prisma/repositories/PrismaFeedbackRepository'

async function main() {
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; embeddingText: string | null; aiDescription: string | null }>>`
    SELECT f.id, p.title, f."embeddingText", a.description AS "aiDescription"
    FROM "listing_feedbacks" f
    JOIN "lbc_product_listings" p ON p.id = f."listingId"
    LEFT JOIN "ai_analyses" a ON a."listingId" = f."listingId"
    WHERE f.embedding IS NULL
  `
  console.log(`${rows.length} feedback rows without an embedding`)

  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required')
  const embedder = new EmbeddingService(env.OPENAI_API_KEY)
  const repo = new PrismaFeedbackRepository(prisma)
  let done = 0
  let failed = 0
  for (const row of rows) {
    // Same text the feedback route embeds, rebuilt when it was never stored.
    const text = row.embeddingText?.trim() || `${row.title}. ${row.aiDescription ?? ''}`.trim()
    try {
      await repo.updateEmbedding(row.id, await embedder.embed(text))
      done++
    } catch (err) {
      failed++
      console.error(`Embedding failed for ${row.id}:`, err)
    }
  }
  console.log(`Embedded ${done}, failed ${failed}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
