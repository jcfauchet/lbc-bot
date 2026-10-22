#!/usr/bin/env node
/**
 * Offline backtest of the Claude judges against what production already stored,
 * before letting them answer ahead of Gemini.
 *
 * Usage:
 *   npx tsx src/cli/eval-claude-judges.ts --step comp|reference|ranking [--limit N] [--concurrency 3]
 *                                         [--provider claude|gemini|both] [--photos 4] [--comp-photos 2]
 *                                         [--claude-model claude-opus-5-5] [--listings id,id] [--out verdicts.json]
 *
 * - comp: replays the comp check on the Lens thumbnails stored in ai_analyses.compCheck with
 *   the chosen verifiers, number of ad photos and dealer-page photos per comparable, next to
 *   the stored production verdict.
 *   --out writes every per-comparable verdict, to score against human votes. No SerpApi credit.
 * - reference: replays the reference verifier on stored reference_matches (highest photo
 *   similarity first) and lists every match Claude confirms where Gemini did not.
 * - ranking: has Claude rank shuffled shortlists of voted listings and reports how many
 *   👍 land in its top picks against the shortlist base rate.
 *
 * Needs ANTHROPIC_API_KEY, plus GOOGLE_GEMINI_API_KEY for a Gemini replay (dotenv only
 * reads .env, so export keys kept in .env.local).
 * Costs Opus calls: roughly $0.07 per comp/reference case, $0.20 per ranking shortlist.
 */
import { writeFileSync } from 'node:fs'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { container } from '@/infrastructure/di/container'
import { ClaudeCompVerifier } from '@/infrastructure/ai/Anthropic/ClaudeCompVerifier'
import { GeminiCompVerifier } from '@/infrastructure/ai/Gemini/GeminiCompVerifier'
import type { ICompVerifier } from '@/domain/services/ICompVerifier'
import { ProductPhotoCompVerifier } from '@/infrastructure/ai/ProductPhotoCompVerifier'
import { ClaudeReferenceMatchVerifier } from '@/infrastructure/ai/Anthropic/ClaudeReferenceMatchVerifier'
import { ClaudeSelectionRanker } from '@/infrastructure/ai/Anthropic/ClaudeSelectionRanker'
import type { CheckedComp, CompCheck } from '@/domain/entities/AiAnalysis'
import type { CompMatch } from '@/domain/services/ICompService'
import type { RankingCandidate } from '@/domain/services/ISelectionRanker'
import { parseEvalClaudeJudgesArgs, type EvalClaudeJudgesArgs } from './eval-claude-judges-args'

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

/** One replayed comparable: the stored production verdict next to each replayed one. */
interface CompVerdictRow {
  listingId: string
  listingTitle: string
  link: string
  compTitle: string
  storedGemini: boolean
  claude?: boolean
  gemini?: boolean
}

async function evalComp(args: EvalClaudeJudgesArgs): Promise<void> {
  const { limit, concurrency, provider, photos, out, compPhotos, claudeModel, listingIds } = args
  const rows = await prisma.$queryRaw<Array<{ listingId: string; title: string; compCheck: CompCheck; imageUrls: string[] }>>`
    SELECT a."listingId", l.title, a."compCheck",
      ARRAY(SELECT i."urlRemote" FROM listing_images i WHERE i."listingId" = l.id ORDER BY i.position ASC, i."createdAt" ASC LIMIT ${photos}) AS "imageUrls"
    FROM ai_analyses a JOIN lbc_product_listings l ON l.id = a."listingId"
    WHERE a."compCheck" IS NOT NULL AND a."compCheck"::text <> 'null'
    ORDER BY a."createdAt" DESC LIMIT ${limit}
  `
  const cases = rows.filter((r) => r.imageUrls.length && r.compCheck.candidates.some((c) => c.imageUrl)
    && (!listingIds || listingIds.includes(r.listingId)))
  const withPhotos = (v: ICompVerifier) => (compPhotos > 0 ? new ProductPhotoCompVerifier(v, compPhotos) : v)
  const verifiers: Array<['claude' | 'gemini', ICompVerifier]> = []
  if (provider !== 'gemini') verifiers.push(['claude', withPhotos(new ClaudeCompVerifier(requireKey(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY'), claudeModel))])
  if (provider !== 'claude') verifiers.push(['gemini', withPhotos(new GeminiCompVerifier(requireKey(env.GOOGLE_GEMINI_API_KEY, 'GOOGLE_GEMINI_API_KEY')))])
  console.log(`🧪 Comp check — ${cases.length} stored checks replayed on ${verifiers.map(([n]) => n).join(' + ')}${claudeModel ? ` (${claudeModel})` : ''}, up to ${photos} ad photo(s), ${compPhotos || 'thumbnail only'} dealer photo(s) per comp`)

  const perAd = await mapConcurrent(cases, concurrency, async (r) => {
    // Same candidates and order production showed: those with a thumbnail, first 8.
    const shown = r.compCheck.candidates.filter((c) => c.imageUrl).slice(0, 8)
    const asMatch = (c: CheckedComp): CompMatch => ({ title: c.title, link: c.link, source: c.source, isValueDomain: true, imageUrl: c.imageUrl })
    const input = { listingImageUrls: r.imageUrls, listingTitle: r.title, comps: shown.map(asMatch) }
    const verdicts = await Promise.all(verifiers.map(async ([name, v]) => [name, new Set((await v.verify(input)).map((m) => m.link))] as const))
    return shown.map((c): CompVerdictRow => ({
      listingId: r.listingId, listingTitle: r.title, link: c.link, compTitle: c.title, storedGemini: c.confirmed,
      ...Object.fromEntries(verdicts.map(([name, set]) => [name, set.has(c.link)])),
    }))
  })
  const comps = perAd.flat()

  const count = (pick: (c: CompVerdictRow) => boolean | undefined) => comps.filter((c) => pick(c)).length
  console.log(`\n${comps.length} comparables on ${perAd.length} ads. Confirmed as same model:`)
  console.log(`  stored Gemini (1 photo, production): ${count((c) => c.storedGemini)}`)
  for (const [name] of verifiers) console.log(`  ${name} replay: ${count((c) => c[name])}`)
  if (verifiers.length === 2) console.log(`  consensus (both replays agree): ${count((c) => c.claude && c.gemini)}`)
  if (out) {
    writeFileSync(out, JSON.stringify(comps, null, 2))
    console.log(`\nPer-comparable verdicts written to ${out}`)
  }
}

function requireKey(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set`)
  return value
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
  const args = parseEvalClaudeJudgesArgs(process.argv.slice(2))
  if (args.step === 'comp') return evalComp(args)
  const key = requireKey(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY')
  if (args.step === 'reference') await evalReference(key, args.limit, args.concurrency)
  else await evalRanking(key, args.limit, args.concurrency)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
