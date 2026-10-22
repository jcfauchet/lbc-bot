#!/usr/bin/env node
/**
 * Offline backtest of the Claude judges against what production already stored,
 * before letting them answer ahead of Gemini.
 *
 * Usage:
 *   npx tsx src/cli/eval-claude-judges.ts --step comp|reference|ranking [--limit N] [--concurrency 3]
 *
 * - comp: replays the comp check on the Lens thumbnails stored in ai_analyses.compCheck
 *   and compares Claude's verdicts with Gemini's, per comparable and per ad. No SerpApi credit.
 * - reference: replays the reference verifier on stored reference_matches (highest photo
 *   similarity first) and lists every match Claude confirms where Gemini did not.
 * - ranking: has Claude rank shuffled shortlists of voted listings and reports how many
 *   👍 land in its top picks against the shortlist base rate.
 *
 * Needs ANTHROPIC_API_KEY (dotenv only reads .env, so export it from .env.local).
 * Costs Opus calls: roughly $0.07 per comp/reference case, $0.20 per ranking shortlist.
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { container } from '@/infrastructure/di/container'
import { ClaudeCompVerifier } from '@/infrastructure/ai/Anthropic/ClaudeCompVerifier'
import { ClaudeReferenceMatchVerifier } from '@/infrastructure/ai/Anthropic/ClaudeReferenceMatchVerifier'
import { ClaudeSelectionRanker } from '@/infrastructure/ai/Anthropic/ClaudeSelectionRanker'
import type { CheckedComp, CompCheck } from '@/domain/entities/AiAnalysis'
import type { CompMatch } from '@/domain/services/ICompService'
import type { RankingCandidate } from '@/domain/services/ISelectionRanker'
import { parseEvalClaudeJudgesArgs } from './eval-claude-judges-args'

/** Same thresholds as production: the email badge counts ≥2 confirmed comps as a real price. */
const MIN_CONFIRMED_COMPS = 2
const LISTING_PHOTOS = 4
const REFERENCE_PHOTOS = 3
/** Production spends LENS_DAILY_BUDGET / LENS_WINDOWS_PER_DAY credits per ranked shortlist. */
const PICKS_PER_SHORTLIST = Math.max(1, Math.round(env.LENS_DAILY_BUDGET / env.LENS_WINDOWS_PER_DAY))

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  const queue = [...items]
  let done = 0
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        out.push(await fn(item))
      } catch (err) {
        console.error(`  case failed: ${err instanceof Error ? err.message : err}`)
      }
      if (++done % 10 === 0) console.log(`  ...${done}/${items.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a'
}

async function evalComp(key: string, limit: number, concurrency: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ listingId: string; title: string; compCheck: CompCheck; imageUrl: string | null }>>`
    SELECT a."listingId", l.title, a."compCheck",
      (SELECT i."urlRemote" FROM listing_images i WHERE i."listingId" = l.id ORDER BY i.position ASC, i."createdAt" ASC LIMIT 1) AS "imageUrl"
    FROM ai_analyses a JOIN lbc_product_listings l ON l.id = a."listingId"
    WHERE a."compCheck" IS NOT NULL AND a."compCheck"::text <> 'null'
    ORDER BY a."createdAt" DESC LIMIT ${limit}
  `
  const cases = rows.filter((r) => r.imageUrl && r.compCheck.candidates.some((c) => c.imageUrl))
  console.log(`🧪 Comp check — ${cases.length} stored Gemini checks replayed on Claude`)
  const verifier = new ClaudeCompVerifier(key)

  const results = await mapConcurrent(cases, concurrency, async (r) => {
    const shown = r.compCheck.candidates.filter((c) => c.imageUrl)
    const asMatch = (c: CheckedComp): CompMatch => ({ title: c.title, link: c.link, source: c.source, isValueDomain: true, imageUrl: c.imageUrl })
    const confirmed = new Set((await verifier.verify({ listingImageUrl: r.imageUrl!, listingTitle: r.title, comps: shown.map(asMatch) })).map((m) => m.link))
    return { ...r, shown: shown.slice(0, 8).map((c) => ({ ...c, claude: confirmed.has(c.link) })) }
  })

  const comps = results.flatMap((r) => r.shown)
  const both = comps.filter((c) => c.confirmed && c.claude).length
  const geminiOnly = comps.filter((c) => c.confirmed && !c.claude)
  const claudeOnly = comps.filter((c) => !c.confirmed && c.claude)
  console.log(`\nPer comparable (${comps.length}): both yes ${both} · Gemini only ${geminiOnly.length} · Claude only ${claudeOnly.length} · both no ${comps.length - both - geminiOnly.length - claudeOnly.length}`)
  const geminiAds = results.filter((r) => r.shown.filter((c) => c.confirmed).length >= MIN_CONFIRMED_COMPS).length
  const claudeAds = results.filter((r) => r.shown.filter((c) => c.claude).length >= MIN_CONFIRMED_COMPS).length
  console.log(`Ads with ≥${MIN_CONFIRMED_COMPS} confirmed comps: Gemini ${geminiAds}/${results.length} · Claude ${claudeAds}/${results.length}`)
  console.log('\nDisagreements (open the links to judge who is right):')
  for (const r of results) {
    for (const c of r.shown.filter((x) => x.confirmed !== x.claude)) {
      console.log(`  [${c.claude ? 'Claude yes / Gemini no' : 'Gemini yes / Claude no'}] "${r.title}" ↔ "${c.title}"\n    ad ${r.imageUrl}\n    comp ${c.link}`)
    }
  }
}

async function evalReference(key: string, limit: number, concurrency: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    title: string; similarity: number; geminiSame: boolean; geminiReason: string | null
    name: string; note: string | null; listingUrls: string[]; referenceUrls: string[]; url: string
  }>>`
    SELECT l.url, l.title, m.similarity, m.confirmed AS "geminiSame", m.reason AS "geminiReason", r.name, r.note,
      ARRAY(SELECT i."urlRemote" FROM listing_images i WHERE i."listingId" = l.id ORDER BY i.position ASC LIMIT ${LISTING_PHOTOS}) AS "listingUrls",
      ARRAY(SELECT ri."urlRemote" FROM reference_images ri WHERE ri."referenceId" = r.id ORDER BY ri."createdAt" ASC LIMIT ${REFERENCE_PHOTOS}) AS "referenceUrls"
    FROM reference_matches m
    JOIN lbc_product_listings l ON l.id = m."listingId"
    JOIN photo_references r ON r.id = m."referenceId"
    ORDER BY m.similarity DESC LIMIT ${limit}
  `
  const cases = rows.filter((r) => r.listingUrls.length && r.referenceUrls.length)
  console.log(`🧪 Reference match — ${cases.length} stored matches (highest similarity first) replayed on Claude`)
  const verifier = new ClaudeReferenceMatchVerifier(key)
  const results = await mapConcurrent(cases, concurrency, async (r) => ({
    ...r,
    claude: await verifier.verify({
      listingImageUrls: r.listingUrls, listingTitle: r.title, referenceImageUrls: r.referenceUrls, referenceName: r.name, referenceNote: r.note,
    }),
  }))
  const agree = results.filter((r) => r.claude.same === r.geminiSame).length
  console.log(`\nAgreement ${agree}/${results.length} · Gemini confirmed ${results.filter((r) => r.geminiSame).length} · Claude confirmed ${results.filter((r) => r.claude.same).length}`)
  console.log('\nDisagreements (check the ad against the reference):')
  for (const r of results.filter((x) => x.claude.same !== x.geminiSame)) {
    console.log(`  [${r.claude.same ? 'Claude yes / Gemini no' : 'Gemini yes / Claude no'}] "${r.title}" vs reference "${r.name}" (similarity ${r.similarity.toFixed(2)})`)
    console.log(`    Claude: ${r.claude.reason ?? '—'}\n    Gemini: ${r.geminiReason ?? '—'}\n    ${r.url}`)
  }
}

/** Deterministic shuffle so two runs rank the same shortlists. */
function seededShuffle<T>(items: T[], seed = 42): T[] {
  const out = [...items]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function evalRanking(key: string, limit: number, concurrency: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; priceCents: number; description: string | null; isGood: boolean; imageUrl: string | null }>>`
    SELECT l.id, l.title, l."priceCents", l.description, f."isGood",
      (SELECT i."urlRemote" FROM listing_images i WHERE i."listingId" = l.id ORDER BY i.position ASC, i."createdAt" ASC LIMIT 1) AS "imageUrl"
    FROM listing_feedbacks f JOIN lbc_product_listings l ON l.id = f."listingId"
    ORDER BY f."createdAt" DESC LIMIT ${limit}
  `
  const voted = seededShuffle(rows.filter((r) => r.imageUrl))
  const isGood = new Map(voted.map((r) => [r.id, r.isGood]))
  const size = env.RANKING_SHORTLIST_SIZE
  const shortlists: RankingCandidate[][] = []
  for (let i = 0; i + size <= voted.length; i += size) {
    shortlists.push(voted.slice(i, i + size).map((r) => ({
      listingId: r.id, imageUrl: r.imageUrl!, title: r.title, priceEur: r.priceCents / 100, description: r.description ?? undefined,
    })))
  }
  const guidance = (await container.triageGuidanceRepository.getLatest())?.content ?? null
  console.log(`🧪 Ranking — ${shortlists.length} shortlists of ${size} voted listings, top ${PICKS_PER_SHORTLIST} picks each, guidance ${guidance ? 'ON' : 'OFF'}`)
  const ranker = new ClaudeSelectionRanker(key)
  const results = await mapConcurrent(shortlists, concurrency, async (list) => ({ list, picks: await ranker.rank(list, guidance) }))

  const pool = results.flatMap((r) => r.list)
  const top = results.flatMap((r) => r.picks.filter((p) => p.worthCredit).slice(0, PICKS_PER_SHORTLIST))
  const worth = results.flatMap((r) => r.picks.filter((p) => p.worthCredit))
  const goods = (ids: { listingId: string }[]) => ids.filter((p) => isGood.get(p.listingId)).length
  console.log(`\nBase rate (👍 in shortlists): ${pct(goods(pool), pool.length)} of ${pool.length}`)
  console.log(`Claude top ${PICKS_PER_SHORTLIST} picks: ${pct(goods(top), top.length)} 👍 of ${top.length} — what production would spend Lens credits on`)
  console.log(`All picks flagged worthCredit: ${pct(goods(worth), worth.length)} 👍 of ${worth.length}`)
}

async function main() {
  const { step, limit, concurrency } = parseEvalClaudeJudgesArgs(process.argv.slice(2))
  const key = env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  if (step === 'comp') await evalComp(key, limit, concurrency)
  else if (step === 'reference') await evalReference(key, limit, concurrency)
  else await evalRanking(key, limit, concurrency)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
