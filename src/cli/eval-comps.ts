#!/usr/bin/env node
/**
 * Offline comps backtest: replays Gemini + Google Search comparables on listings
 * the user already labelled (👍/👎) and that Lens had priced, then compares both
 * providers on coverage, precision and recall of a positive margin.
 *
 * Usage:
 *   npx tsx src/cli/eval-comps.ts [--limit 300] [--concurrency 3] [--model gemini-3.6-flash]
 *
 * Notes:
 * - The set only holds listings Lens managed to price (an analysis exists), so
 *   Lens coverage is 100% by construction; Gemini coverage is the real number.
 * - Gemini margins use the same scoring and resale factor as production.
 * - One grounded Gemini call per listing (a few search queries each).
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { GeminiSearchCompService } from '@/infrastructure/ai/Gemini/GeminiSearchCompService'
import { isMassMarketCommon, scoreComps } from '@/domain/services/comp-scoring'
import { parseEvalCompsArgs } from './eval-comps-args'

interface VotedAnalysis {
  listingId: string
  title: string
  description: string | null
  priceCents: number
  lensMarginCents: number
  isGood: boolean
  imageUrl: string | null
}

interface EvalRow extends VotedAnalysis {
  geminiEstimateEur: number | null
  geminiMarginEur: number | null
  geminiComps: number
  geminiMassMarket: boolean
  confidence: string
}

async function loadVoted(limit: number): Promise<VotedAnalysis[]> {
  return prisma.$queryRaw<VotedAnalysis[]>`
    SELECT a."listingId", l."title", l."description", l."priceCents", a."marginCents" AS "lensMarginCents", f."isGood",
      (SELECT i."urlRemote" FROM "listing_images" i
       WHERE i."listingId" = l.id ORDER BY i."position" ASC, i."createdAt" ASC LIMIT 1) AS "imageUrl"
    FROM "ai_analyses" a
    JOIN "listing_feedbacks" f ON f."listingId" = a."listingId"
    JOIN "lbc_product_listings" l ON l.id = a."listingId"
    ORDER BY f."createdAt" DESC
    LIMIT ${limit}
  `
}

async function scoreAll(service: GeminiSearchCompService, rows: VotedAnalysis[], concurrency: number): Promise<EvalRow[]> {
  const out: EvalRow[] = []
  const queue = [...rows]
  let done = 0
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const { matches } = await service.findComps(item.imageUrl!, {
          title: item.title, description: item.description, priceEur: item.priceCents / 100,
        })
        const massMarket = isMassMarketCommon(matches, env.MASS_MARKET_MIN_MATCHES)
        const score = scoreComps(matches)
        const estimate = score.estimatedValueEur === null ? null : Math.round(score.estimatedValueEur * env.RESALE_REALIZATION_FACTOR)
        const row: EvalRow = {
          ...item,
          geminiEstimateEur: massMarket ? null : estimate,
          geminiMarginEur: massMarket || estimate === null ? null : estimate - item.priceCents / 100,
          geminiComps: score.pricedCompCount,
          geminiMassMarket: massMarket,
          confidence: score.confidence,
        }
        out.push(row)
        console.log(csvLine(row))
      } catch (err) {
        console.error(`  comps failed for ${item.listingId}: ${err instanceof Error ? err.message : err}`)
      }
      done++
      if (done % 20 === 0) console.error(`  ...${done}/${rows.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a'
}

const CSV_HEADER = 'listingId,priceEur,vote,lensMarginEur,geminiEstimateEur,geminiMarginEur,geminiComps,confidence,massMarket,title'

/** One line per listing, printed as soon as it is scored so a killed run still leaves data. */
function csvLine(r: EvalRow): string {
  return [
    r.listingId, r.priceCents / 100, r.isGood ? 'good' : 'bad', r.lensMarginCents / 100,
    r.geminiEstimateEur ?? '', r.geminiMarginEur ?? '', r.geminiComps, r.confidence, r.geminiMassMarket,
    JSON.stringify(r.title),
  ].join(',')
}

function report(rows: EvalRow[]): void {
  const good = rows.filter((r) => r.isGood).length

  const lensPositive = rows.filter((r) => r.lensMarginCents > 0)
  const geminiPriced = rows.filter((r) => r.geminiEstimateEur !== null)
  const geminiPositive = rows.filter((r) => (r.geminiMarginEur ?? -1) > 0)
  const goodIn = (set: EvalRow[]) => set.filter((r) => r.isGood).length

  console.log(`\nScored ${rows.length} voted analyses (${good} 👍 / ${rows.length - good} 👎)\n`)
  console.log('provider | priced | margin>0 | precision | recall')
  console.log('---------|--------|----------|-----------|-------')
  console.log(`lens     | ${pct(rows.length, rows.length).padStart(6)} | ${String(lensPositive.length).padStart(8)} | ${pct(goodIn(lensPositive), lensPositive.length).padStart(9)} | ${pct(goodIn(lensPositive), good).padStart(6)}`)
  console.log(`gemini   | ${pct(geminiPriced.length, rows.length).padStart(6)} | ${String(geminiPositive.length).padStart(8)} | ${pct(goodIn(geminiPositive), geminiPositive.length).padStart(9)} | ${pct(goodIn(geminiPositive), good).padStart(6)}`)
  console.log(`\nmass-market by gemini: ${rows.filter((r) => r.geminiMassMarket).length} (${goodIn(rows.filter((r) => r.geminiMassMarket))} were 👍)`)
  console.log('Read: precision is what the reseller sees in her inbox; recall is how many of her 👍 the provider would have surfaced.')
}

async function main() {
  const { limit, concurrency, model } = parseEvalCompsArgs(process.argv.slice(2))
  console.log(`🧪 Comps eval — ${model} + Google Search, limit ${limit}`)
  const voted = (await loadVoted(limit)).filter((r) => r.imageUrl)
  console.log(`Loaded ${voted.length} voted analyses with an image.`)
  const service = new GeminiSearchCompService(env.GOOGLE_GEMINI_API_KEY ?? 'missing-google-gemini-api-key', model)
  console.log(CSV_HEADER)
  report(await scoreAll(service, voted, concurrency))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
