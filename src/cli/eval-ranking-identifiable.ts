#!/usr/bin/env node
/**
 * Backtest of a ranking prompt that asks for pieces the appraisal agent can
 * identify. It re-ranks the ads the agent already appraised, in shuffled batches,
 * with the production prompt and with the variant, and compares how many of the
 * ads each prompt would spend a credit on were ones the agent could price
 * (one same-model comparable or more). An ad whose photo no longer loads is left
 * out by the ranker and counts as not picked, in both arms.
 *
 * Usage:
 *   npx tsx src/cli/eval-ranking-identifiable.ts [--batch 14] [--seeds 2]
 *
 * Cost: two Opus calls per batch and per seed, one photo per ad. No Lens credit.
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import type { RankedPick, RankingCandidate } from '@/domain/services/ISelectionRanker'
import { ClaudeSelectionRanker } from '@/infrastructure/ai/Anthropic/ClaudeSelectionRanker'
import { RANKING_PROMPT } from '@/infrastructure/ai/ranking-prompt'

/**
 * The variant tested. Result on 11 Nov 2026, 83 appraised ads, 2 shuffles: its
 * "worth a credit" picks were priced by the agent 43% of the time (12/28), the
 * production prompt's 46% (11/24), all ads 42%. From one photo the ranker cannot
 * tell a known model from an anonymous piece in the same style. Not shipped.
 */
const IDENTIFIABLE_RANKING_PROMPT = [
  'You are helping a vintage furniture & decor reseller spend a very scarce research',
  'budget: only a couple of the listings below can be investigated further today.',
  'They have all already passed a first triage, so they all look plausible — your job',
  'is to RANK them against each other and keep only the safest bets.',
  'The next step is an appraiser who must RECOGNISE the exact model in the photo and',
  'find that same model sold elsewhere. A piece it cannot identify is a wasted credit.',
  'So rank first the pieces whose form, construction or details look like a specific',
  'known model, maker or edition, even though the seller names none.',
  'The seller we are looking for does not know what they are selling: a plain title,',
  'a short description and a modest price on a piece that looks like a known model is',
  'the best signal. A seller who details period, style and materials at length already',
  'knows the value: rank that piece lower.',
  'Set worthCredit to false for anonymous pieces that are merely "in the style of" a',
  'period or a maker (generic neoclassical brass-and-marble tables, unsigned',
  'period-style furniture) and that no catalogue would list as a model; for small',
  'objects and collectibles (inkstands, instruments, bookends, tableware, boxes); and',
  'for anything mass-market, modern, reproduction, or damaged beyond value.',
  'An implausibly large gap between the asking price and the apparent value is not a',
  'reason on its own: judge whether the model can be recognised.',
  'Do not pad the list: returning fewer picks is better than returning a weak one.',
  'Reply with strict JSON, best candidate first:',
  '{"picks":[{"candidate":<number>,"worthCredit":<true|false>,"reason":"<short>"}]}',
].join(' ')


interface Appraised extends RankingCandidate {
  priced: boolean
  isGood: boolean | null
}

type Arm = 'current' | 'identifiable'

interface Verdict {
  ad: Appraised
  arm: Arm
  seed: number
  /** Null when the ranker left the ad out of its answer. */
  rank: number | null
  worthCredit: boolean
  batchSize: number
  reason?: string
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

/** Deterministic shuffle, so both prompts see the same batches. */
function shuffled<T>(items: T[], seed: number): T[] {
  let state = seed * 2654435761 % 2 ** 32
  const next = () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function loadAppraised(): Promise<Appraised[]> {
  const rows = await prisma.$queryRaw<Array<{
    listingId: string; title: string; priceCents: number; description: string | null; imageUrl: string | null; compCount: number; isGood: boolean | null
  }>>`
    SELECT l.id AS "listingId", l.title, l."priceCents", l.description, r."compCount",
      (SELECT i."urlRemote" FROM "listing_images" i WHERE i."listingId" = l.id ORDER BY i."position" ASC, i."createdAt" ASC LIMIT 1) AS "imageUrl",
      (SELECT f."isGood" FROM "listing_feedbacks" f WHERE f."listingId" = l.id ORDER BY f."createdAt" DESC LIMIT 1) AS "isGood"
    FROM "appraisal_runs" r JOIN "lbc_product_listings" l ON l.id = r."listingId"
    ORDER BY r."createdAt"`
  return rows.flatMap((r) => (r.imageUrl ? [{
    listingId: r.listingId, title: r.title, priceEur: Math.round(r.priceCents / 100), description: r.description ?? undefined,
    imageUrl: r.imageUrl, priced: r.compCount > 0, isGood: r.isGood,
  }] : []))
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%` : 'n/a'
}

function report(verdicts: Verdict[]): void {
  console.log('\nrule                              | kept | priced | precision | recall of priced')
  console.log('----------------------------------|------|--------|-----------|-----------------')
  for (const arm of ['current', 'identifiable'] as const) {
    const all = verdicts.filter((v) => v.arm === arm)
    const priced = all.filter((v) => v.ad.priced).length
    const line = (name: string, keep: (v: Verdict) => boolean) => {
      const kept = all.filter(keep)
      const hit = kept.filter((v) => v.ad.priced).length
      console.log(`${`${arm}: ${name}`.padEnd(34)}| ${String(kept.length).padStart(4)} | ${String(hit).padStart(6)} | ${pct(hit, kept.length).padStart(9)} | ${pct(hit, priced).padStart(6)}`)
    }
    line('all ads shown', () => true)
    line('worth a credit', (v) => v.worthCredit)
    line('top third of the batch', (v) => v.rank !== null && v.rank <= Math.ceil(v.batchSize / 3))
    line('top 3 of the batch', (v) => v.rank !== null && v.rank <= 3)
  }
}

async function main() {
  const batchSize = Number(arg('--batch', '14'))
  const seeds = Number(arg('--seeds', '2'))
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
  const rankers: Record<Arm, ClaudeSelectionRanker> = {
    current: new ClaudeSelectionRanker(env.ANTHROPIC_API_KEY, undefined, RANKING_PROMPT),
    identifiable: new ClaudeSelectionRanker(env.ANTHROPIC_API_KEY, undefined, IDENTIFIABLE_RANKING_PROMPT),
  }
  const guidance = (await prisma.triageGuidance.findFirst({ orderBy: { createdAt: 'desc' } }))?.content ?? null
  const ads = await loadAppraised()
  const priced = ads.filter((a) => a.priced).length
  console.error(`🧪 Ranking backtest — ${ads.length} appraised ads (${priced} priced by the agent, ${pct(priced, ads.length)}), batches of ${batchSize}, ${seeds} shuffles`)

  const verdicts: Verdict[] = []
  console.log('seed,arm,rank,worthCredit,priced,vote,price,title,reason')
  for (let seed = 1; seed <= seeds; seed++) {
    const order = shuffled(ads, seed)
    const batches = Array.from({ length: Math.ceil(order.length / batchSize) }, (_, i) => order.slice(i * batchSize, (i + 1) * batchSize))
    await Promise.all(batches.flatMap((batch) => (['current', 'identifiable'] as const).map(async (arm) => {
      let picks: RankedPick[]
      try {
        picks = await rankers[arm].rank(batch, guidance)
      } catch (err) {
        console.error(`  ${arm} batch failed: ${err instanceof Error ? err.message : err}`)
        return
      }
      for (const ad of batch) {
        const pick = picks.find((p) => p.listingId === ad.listingId)
        const v: Verdict = { ad, arm, seed, rank: pick?.rank ?? null, worthCredit: pick?.worthCredit ?? false, batchSize: batch.length, reason: pick?.reason }
        verdicts.push(v)
        console.log([seed, arm, v.rank ?? '', v.worthCredit, ad.priced, ad.isGood ?? '', ad.priceEur, JSON.stringify(ad.title), JSON.stringify(v.reason ?? '')].join(','))
      }
    })))
  }
  report(verdicts)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
