#!/usr/bin/env node
/**
 * Backtest of the visual comp check: replays Lens on voted analyses, then asks
 * Gemini which comparables show the same model, and compares the estimate built
 * from every value comp (today's behaviour) with the one built from confirmed
 * comps only.
 *
 * Usage:
 *   npx tsx src/cli/eval-comp-verify.ts [--per-vote 15] [--concurrency 3]
 *
 * Notes:
 * - Spends one SerpApi credit per listing (free plan: 250/month). Keep --per-vote small.
 * - Lens results drift over time, so the replayed raw margin can differ from the
 *   margin stored when the ad was notified; both are printed.
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { SerpApiLensCompService } from '@/infrastructure/comps/SerpApiLensCompService'
import { GeminiCompVerifier } from '@/infrastructure/ai/Gemini/GeminiCompVerifier'
import { isMassMarketCommon, scoreComps } from '@/domain/services/comp-scoring'
import type { CompMatch } from '@/domain/services/ICompService'
import { parseEvalCompVerifyArgs } from './eval-comp-verify-args'

interface VotedAnalysis {
  listingId: string
  title: string
  priceCents: number
  storedMarginCents: number
  isGood: boolean
  imageUrl: string | null
}

interface EvalRow extends VotedAnalysis {
  rawEstimateEur: number | null
  rawMarginEur: number | null
  rawComps: number
  verifiedEstimateEur: number | null
  verifiedMarginEur: number | null
  verifiedComps: number
  candidates: number
}

/** Confirmed comps below this leave the estimate blank: one match is a coincidence, not a price. */
const MIN_VERIFIED_COMPS = 2

async function loadVoted(perVote: number): Promise<VotedAnalysis[]> {
  return prisma.$queryRaw<VotedAnalysis[]>`
    WITH voted AS (
      SELECT a."listingId", l."title", l."priceCents", a."marginCents" AS "storedMarginCents", f."isGood",
        (SELECT i."urlRemote" FROM "listing_images" i
         WHERE i."listingId" = l.id ORDER BY i."position" ASC, i."createdAt" ASC LIMIT 1) AS "imageUrl",
        ROW_NUMBER() OVER (PARTITION BY f."isGood" ORDER BY f."createdAt" DESC) AS rn
      FROM "ai_analyses" a
      JOIN "listing_feedbacks" f ON f."listingId" = a."listingId"
      JOIN "lbc_product_listings" l ON l.id = a."listingId"
    )
    SELECT "listingId", "title", "priceCents", "storedMarginCents", "isGood", "imageUrl"
    FROM voted WHERE rn <= ${perVote} ORDER BY "isGood" DESC, rn
  `
}

function estimate(matches: CompMatch[]): { estimateEur: number | null; comps: number } {
  if (isMassMarketCommon(matches, env.MASS_MARKET_MIN_MATCHES)) return { estimateEur: null, comps: 0 }
  const score = scoreComps(matches)
  return {
    estimateEur: score.estimatedValueEur === null ? null : Math.round(score.estimatedValueEur * env.RESALE_REALIZATION_FACTOR),
    comps: score.pricedCompCount,
  }
}

const CSV_HEADER = 'listingId,vote,priceEur,storedMarginEur,rawEstimateEur,rawMarginEur,rawComps,candidates,verifiedComps,verifiedEstimateEur,verifiedMarginEur,title'

function csvLine(r: EvalRow): string {
  return [
    r.listingId, r.isGood ? 'good' : 'bad', r.priceCents / 100, r.storedMarginCents / 100,
    r.rawEstimateEur ?? '', r.rawMarginEur ?? '', r.rawComps, r.candidates, r.verifiedComps,
    r.verifiedEstimateEur ?? '', r.verifiedMarginEur ?? '', JSON.stringify(r.title),
  ].join(',')
}

async function scoreAll(lens: SerpApiLensCompService, verifier: GeminiCompVerifier, rows: VotedAnalysis[], concurrency: number): Promise<EvalRow[]> {
  const out: EvalRow[] = []
  const queue = [...rows]
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const { matches } = await lens.findComps(item.imageUrl!)
        const raw = estimate(matches)
        const candidates = matches.filter((m) => m.isValueDomain && m.price)
        const confirmed = await verifier.verify({ listingImageUrl: item.imageUrl!, listingTitle: item.title, comps: candidates })
        const verified = confirmed.length >= MIN_VERIFIED_COMPS ? estimate(confirmed) : { estimateEur: null, comps: confirmed.length }
        const price = item.priceCents / 100
        const row: EvalRow = {
          ...item,
          rawEstimateEur: raw.estimateEur, rawMarginEur: raw.estimateEur === null ? null : raw.estimateEur - price, rawComps: raw.comps,
          candidates: candidates.length, verifiedComps: confirmed.length,
          verifiedEstimateEur: verified.estimateEur, verifiedMarginEur: verified.estimateEur === null ? null : verified.estimateEur - price,
        }
        out.push(row)
        console.log(csvLine(row))
      } catch (err) {
        console.error(`  failed for ${item.listingId}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a'
}

function report(rows: EvalRow[]): void {
  const good = rows.filter((r) => r.isGood).length
  const line = (name: string, selected: EvalRow[]) => {
    const g = selected.filter((r) => r.isGood).length
    console.log(`${name.padEnd(28)} | ${String(selected.length).padStart(8)} | ${pct(g, selected.length).padStart(9)} | ${pct(g, good).padStart(6)}`)
  }
  console.log(`\nScored ${rows.length} voted analyses (${good} 👍 / ${rows.length - good} 👎); production notifies at ${env.MIN_MARGIN_IN_EUR}€\n`)
  console.log('estimate                     | notified | precision | recall')
  console.log('-----------------------------|----------|-----------|-------')
  for (const threshold of [100, 200, 400]) {
    line(`stored         margin ≥${threshold}€`, rows.filter((r) => r.storedMarginCents / 100 >= threshold))
    line(`raw replay     margin ≥${threshold}€`, rows.filter((r) => (r.rawMarginEur ?? -1) >= threshold))
    line(`verified comps margin ≥${threshold}€`, rows.filter((r) => (r.verifiedMarginEur ?? -1) >= threshold))
    const dropped = rows.filter((r) => (r.rawMarginEur ?? -1) >= threshold && (r.verifiedMarginEur ?? -1) < threshold)
    console.log(`  → verification mutes ${dropped.length} of the raw notifications: ${dropped.filter((r) => r.isGood).length} 👍, ${dropped.filter((r) => !r.isGood).length} 👎`)
  }
  console.log(`confirmed comps per ad: ${rows.map((r) => `${r.verifiedComps}/${r.candidates}`).join(' ')}`)
}

async function main() {
  const { perVote, concurrency } = parseEvalCompVerifyArgs(process.argv.slice(2))
  const voted = (await loadVoted(perVote)).filter((r) => r.imageUrl)
  console.error(`🧪 Comp verification eval — ${voted.length} voted analyses, ${voted.length} Lens credits`)
  const lens = new SerpApiLensCompService(env.SERPAPI_KEY ?? 'missing-serpapi-key')
  const verifier = new GeminiCompVerifier(env.GOOGLE_GEMINI_API_KEY ?? 'missing-google-gemini-api-key')
  console.log(CSV_HEADER)
  report(await scoreAll(lens, verifier, voted, concurrency))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
