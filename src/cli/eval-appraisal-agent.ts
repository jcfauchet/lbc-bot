#!/usr/bin/env node
/**
 * Backtest of the appraisal agent: lets it research ads the user already voted
 * on (no Lens: web search and dealer pages only), prices them from the same-model
 * comparables it vouches for, and compares its notifications with the estimate
 * stored at the time.
 *
 * Usage:
 *   npx tsx src/cli/eval-appraisal-agent.ts [--per-vote 10] [--concurrency 2]
 *     [--model claude-sonnet-5-5] [--effort medium] [--double-check] [--max-usd 10]
 *     [--listings id1,id2] [--out run.jsonl] [--lens apify|none] [--lens-cache lens.json]
 *
 * Notes:
 * - The sample is balanced (as many 👍 as 👎), so raw precision overstates what
 *   the inbox would see; the report also reweights it to the real vote base rate.
 * - The stored baseline mixes providers: Lens since June 2026, the older
 *   direct-estimation era before. Both are listed per row in the JSONL.
 * - Spends Claude credits (tokens + 0.01 $ per web search) and, with --lens apify,
 *   about 0.01 $ of Apify credit per ad; --max-usd caps the sum. --lens-cache keeps
 *   the Lens results so re-running a prompt change costs no new search.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { ClaudeAppraisalAgent } from '@/infrastructure/ai/Anthropic/ClaudeAppraisalAgent'
import { ClaudeCompVerifier } from '@/infrastructure/ai/Anthropic/ClaudeCompVerifier'
import { ConsensusCompVerifier } from '@/infrastructure/ai/ConsensusCompVerifier'
import { ApifyLensCompService } from '@/infrastructure/comps/ApifyLensCompService'
import { scoreComps } from '@/domain/services/comp-scoring'
import { DEFAULT_MAX_RANGE_RATIO, isEstimateTrustworthy } from '@/domain/services/DealScoring'
import type { CompMatch } from '@/domain/services/ICompService'
import type { Appraisal } from '@/domain/services/IAppraisalAgent'
import { parseEvalAppraisalAgentArgs } from './eval-appraisal-agent-args'

interface VotedAnalysis {
  listingId: string
  title: string
  description: string | null
  priceCents: number
  isGood: boolean
  provider: string
  storedMarginCents: number
  storedEstMinCents: number
  storedEstMaxCents: number
  storedConfidence: number | null
  storedSource: string | null
  imageUrls: string[] | null
}

interface Estimate {
  medianEur: number
  minEur: number
  maxEur: number
  confidence: number
  source: string | null
}

interface EvalRow {
  item: VotedAnalysis
  appraisal: Appraisal
  /** The agent's comparables that survived the optional consensus re-check. */
  kept: CompMatch[]
  estimate: Estimate | null
  /** Built from every comparable the agent submitted, before any re-check. */
  rawEstimate: Estimate | null
}

/** Apify's per-image charge, counted against --max-usd. */
const APIFY_LENS_USD = 0.01

/**
 * An agent comparable was inspected and judged the same model, unlike a Lens
 * look-alike, so one is already a price. Rules requiring two are reported too.
 */
const MIN_AGENT_COMPS = 1

function estimate(comps: CompMatch[]): Estimate | null {
  if (comps.length < MIN_AGENT_COMPS) return null
  const score = scoreComps(comps)
  if (score.estimatedValueEur === null) return null
  const f = env.RESALE_REALIZATION_FACTOR
  return {
    medianEur: Math.round(score.estimatedValueEur * f),
    minEur: Math.round(score.rangeMinEur! * f),
    maxEur: Math.round(score.rangeMaxEur! * f),
    // Same mapping as RunCompAnalysisUseCase.
    confidence: score.confidence === 'reliable' ? 0.9 : 0.6,
    source: comps[0].source,
  }
}

/** The production email gate (RunNotificationUseCase), on euros. */
function wouldNotify(priceEur: number, e: { medianEur: number; minEur: number; maxEur: number; confidence: number | null; source: string | null }): boolean {
  if (e.medianEur - priceEur < env.MIN_MARGIN_IN_EUR) return false
  if (e.confidence !== null && e.confidence < 0.8) return false
  return isEstimateTrustworthy(
    { priceCents: priceEur * 100, estMinCents: e.minEur * 100, estMaxCents: e.maxEur * 100, bestMatchSource: e.source },
    { maxRangeRatio: DEFAULT_MAX_RANGE_RATIO, minConservativeMarginCents: 0 },
  )
}

async function loadVoted(perVote: number, listings: string[]): Promise<VotedAnalysis[]> {
  const rows = await prisma.$queryRaw<(VotedAnalysis & { rn: bigint })[]>`
    WITH voted AS (
      SELECT a."listingId", l."title", l."description", l."priceCents", f."isGood", a."provider",
        a."marginCents" AS "storedMarginCents", a."estMinCents" AS "storedEstMinCents", a."estMaxCents" AS "storedEstMaxCents",
        a."confidence" AS "storedConfidence", a."bestMatchSource" AS "storedSource",
        (SELECT array_agg(i."urlRemote" ORDER BY i."position" ASC, i."createdAt" ASC) FROM "listing_images" i
         WHERE i."listingId" = l.id) AS "imageUrls",
        ROW_NUMBER() OVER (PARTITION BY f."isGood" ORDER BY f."createdAt" DESC) AS rn
      FROM "ai_analyses" a
      JOIN "listing_feedbacks" f ON f."listingId" = a."listingId"
      JOIN "lbc_product_listings" l ON l.id = a."listingId"
    )
    SELECT * FROM voted ORDER BY "isGood" DESC, rn
  `
  const picked = listings.length ? rows.filter((r) => listings.includes(r.listingId)) : rows.filter((r) => r.rn <= perVote)
  // rn is a BigInt, which JSON.stringify rejects.
  return picked.map(({ rn: _rn, ...row }) => row)
}

async function voteTotals(): Promise<{ good: number; total: number }> {
  const [row] = await prisma.$queryRaw<{ good: bigint; total: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE f."isGood") AS good, COUNT(*) AS total
    FROM "ai_analyses" a JOIN "listing_feedbacks" f ON f."listingId" = a."listingId"
  `
  return { good: Number(row.good), total: Number(row.total) }
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a'
}

function report(rows: EvalRow[], failed: number, base: { good: number; total: number }): void {
  const good = rows.filter((r) => r.item.isGood).length
  const bad = rows.length - good
  // Reweights the balanced sample to the real 👍 share of all voted analyses.
  const wGood = good ? base.good / good : 0
  const wBad = bad ? (base.total - base.good) / bad : 0
  const line = (name: string, selected: EvalRow[]) => {
    const g = selected.filter((r) => r.item.isGood).length
    const b = selected.length - g
    const weighted = g * wGood + b * wBad
    console.log(`${name.padEnd(30)} | ${String(selected.length).padStart(8)} | ${pct(g, selected.length).padStart(9)} | ${(weighted ? `${((100 * g * wGood) / weighted).toFixed(0)}%` : 'n/a').padStart(11)} | ${pct(g, good).padStart(6)}`)
  }
  const price = (r: EvalRow) => r.item.priceCents / 100
  const stored = (r: EvalRow) => ({
    medianEur: price(r) + r.item.storedMarginCents / 100, minEur: r.item.storedEstMinCents / 100, maxEur: r.item.storedEstMaxCents / 100,
    confidence: r.item.storedConfidence, source: r.item.storedSource,
  })

  console.log(`\nAppraised ${rows.length} voted ads (${good} 👍 / ${bad} 👎), ${failed} failed. Real base rate ${pct(base.good, base.total)} (${base.good}/${base.total}).`)
  const priced = rows.filter((r) => r.estimate)
  console.log(`Agent priced ${priced.length}/${rows.length} (≥${MIN_AGENT_COMPS} same-model comps); comps per ad: ${rows.map((r) => r.kept.length).join(' ')}`)
  console.log(`Priced ads that were 👍: ${pct(priced.filter((r) => r.item.isGood).length, priced.length)}\n`)
  console.log('rule                           | notified | precision | at base rate | recall')
  console.log('-------------------------------|----------|-----------|--------------|-------')
  line('stored estimate, prod gate', rows.filter((r) => wouldNotify(price(r), stored(r))))
  line('agent, prod gate', rows.filter((r) => r.estimate && wouldNotify(price(r), r.estimate)))
  for (const threshold of [100, 200]) {
    const agentMargin = (r: EvalRow) => (r.estimate ? r.estimate.medianEur - price(r) : -Infinity)
    line(`stored margin ≥${threshold}€`, rows.filter((r) => r.item.storedMarginCents / 100 >= threshold))
    line(`agent margin ≥${threshold}€`, rows.filter((r) => agentMargin(r) >= threshold))
    line(`agent margin ≥${threshold}€, ≥2 comps`, rows.filter((r) => r.kept.length >= 2 && agentMargin(r) >= threshold))
    if (rows.some((r) => r.kept.length !== r.appraisal.comps.length)) {
      line(`  before re-check ≥${threshold}€`, rows.filter((r) => r.rawEstimate && r.rawEstimate.medianEur - price(r) >= threshold))
    }
  }

  const sum = (f: (r: EvalRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const n = rows.length || 1
  console.log(`\nCost: ${sum((r) => r.appraisal.cost.usd).toFixed(2)} $ total, ${(sum((r) => r.appraisal.cost.usd) / n).toFixed(3)} $/ad;`
    + ` per ad ${(sum((r) => r.appraisal.cost.turns) / n).toFixed(1)} turns, ${(sum((r) => r.appraisal.cost.webSearches) / n).toFixed(1)} searches,`
    + ` ${(sum((r) => r.appraisal.cost.pagesInspected) / n).toFixed(1)} pages`)
}

async function main() {
  const args = parseEvalAppraisalAgentArgs(process.argv.slice(2))
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
  const voted = (await loadVoted(args.perVote, args.listings)).filter((r) => r.imageUrls?.length)
  console.error(`🧪 Appraisal agent eval — ${voted.length} voted ads, ${args.model} (${args.effort}), Lens leads: ${args.lens}${args.doubleCheck ? ', + Opus/Sonnet re-check' : ''}, cap ${args.maxUsd} $`)

  const agent = new ClaudeAppraisalAgent(env.ANTHROPIC_API_KEY, args.model, args.effort)
  const checker = args.doubleCheck
    ? new ConsensusCompVerifier(new ClaudeCompVerifier(env.ANTHROPIC_API_KEY, 'claude-opus-5-5'), new ClaudeCompVerifier(env.ANTHROPIC_API_KEY, 'claude-sonnet-5-5'))
    : null

  if (args.lens === 'apify' && !env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is required for --lens apify')
  const lens = args.lens === 'apify' ? new ApifyLensCompService(env.APIFY_TOKEN!) : null
  const lensCache: Record<string, CompMatch[]> = args.lensCache && existsSync(args.lensCache) ? JSON.parse(readFileSync(args.lensCache, 'utf8')) : {}
  const leadsFor = async (item: VotedAnalysis): Promise<CompMatch[] | undefined> => {
    if (!lens) return undefined
    if (!lensCache[item.listingId]) {
      lensCache[item.listingId] = (await lens.findComps(item.imageUrls![0])).matches
      spent += APIFY_LENS_USD
      if (args.lensCache) writeFileSync(args.lensCache, JSON.stringify(lensCache))
    }
    return lensCache[item.listingId]
  }

  const rows: EvalRow[] = []
  let failed = 0
  let spent = 0
  const queue = [...voted]
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (spent >= args.maxUsd) {
        console.error(`  budget reached (${spent.toFixed(2)} $): skipping the remaining ads`)
        return
      }
      try {
        const leads = await leadsFor(item)
        const appraisal = await agent.appraise({ title: item.title, description: item.description, priceEur: item.priceCents / 100, imageUrls: item.imageUrls!, leads })
        spent += appraisal.cost.usd
        const kept = checker && appraisal.comps.length
          ? await checker.verify({ listingImageUrls: item.imageUrls!, listingTitle: item.title, comps: appraisal.comps })
          : appraisal.comps
        const row: EvalRow = { item, appraisal, kept, estimate: estimate(kept), rawEstimate: estimate(appraisal.comps) }
        if (args.out) appendFileSync(args.out, `${JSON.stringify({ ...item, appraisal, kept: kept.map((c) => c.link), estimate: row.estimate })}\n`)
        rows.push(row)
        const margin = row.estimate ? row.estimate.medianEur - item.priceCents / 100 : null
        const { turns, webSearches, pagesInspected, usd } = appraisal.cost
        console.error(`  ${item.isGood ? '👍' : '👎'} ${item.title.slice(0, 50).padEnd(50)} ${String(kept.length).padStart(2)}/${appraisal.comps.length} comps, margin ${margin ?? '—'} €`
          + ` (${turns} turns, ${webSearches} searches, ${pagesInspected} pages, ${usd.toFixed(3)} $)\n      ${appraisal.identification}\n      ${appraisal.notes}`)
      } catch (err) {
        failed++
        console.error(`  failed for ${item.listingId}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker))
  report(rows, failed, await voteTotals())
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
