#!/usr/bin/env node
/**
 * Backtest of a graded comp check (same model / same line / resemblance) on the
 * voted analyses whose comparables were checked in production. It re-grades the
 * stored comparables, so no Lens credit is spent, with dealer-page photos as in
 * production, by Opus and Sonnet separately and by their consensus (the weaker
 * of the two tiers), then prints precision and recall of each filter rule
 * against the votes, next to the stored binary verdict.
 *
 * Usage:
 *   npx tsx src/cli/eval-comp-tiers.ts [--since 2026-10-13] [--concurrency 3]
 *
 * Cost: two Claude calls per voted analysis, with up to 8 comparables of 3 photos each.
 */
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import type { CheckedComp } from '@/domain/entities/AiAnalysis'
import type { CompMatch } from '@/domain/services/ICompService'
import { ClaudeCompVerifier } from '@/infrastructure/ai/Anthropic/ClaudeCompVerifier'
import { COMP_VERIFY_LISTING_PHOTOS, weakerTier, type CompTier } from '@/infrastructure/ai/comp-verify-prompt'
import { fetchProductPhotos } from '@/infrastructure/comps/product-page-photos'

/** Same as production (container.ts). */
const DEALER_PHOTOS = 2

interface VotedCheck {
  listingId: string
  title: string
  isGood: boolean
  storedConfirmed: number
  candidates: CheckedComp[]
  imageUrls: string[]
}

interface Graded extends VotedCheck {
  opus: CompTier[]
  sonnet: CompTier[]
  consensus: CompTier[]
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

async function loadVoted(since: string): Promise<VotedCheck[]> {
  const rows = await prisma.$queryRaw<Array<Omit<VotedCheck, 'candidates'> & { compCheck: { candidates?: CheckedComp[] } }>>`
    SELECT a."listingId", l."title", f."isGood", a."confirmedCompCount" AS "storedConfirmed", a."compCheck",
      ARRAY(SELECT i."urlRemote" FROM "listing_images" i WHERE i."listingId" = l.id
            ORDER BY i."position" ASC, i."createdAt" ASC LIMIT ${COMP_VERIFY_LISTING_PHOTOS}) AS "imageUrls"
    FROM "ai_analyses" a
    JOIN "listing_feedbacks" f ON f."listingId" = a."listingId"
    JOIN "lbc_product_listings" l ON l.id = a."listingId"
    WHERE a."createdAt" >= ${new Date(since)} AND a."confirmedCompCount" IS NOT NULL
    ORDER BY a."createdAt"
  `
  return rows
    .map(({ compCheck, ...r }) => ({ ...r, candidates: compCheck?.candidates ?? [] }))
    .filter((r) => r.candidates.length > 0 && r.imageUrls.length > 0)
}

/** The stored comparable as the verifiers take it: same order, so tiers line up with `candidates`. */
function toMatch(c: CheckedComp): CompMatch {
  return { title: c.title, link: c.link, source: c.source, imageUrl: c.imageUrl, isValueDomain: true, ...(c.priceEur ? { price: { value: c.priceEur, currency: 'EUR' } } : {}) }
}

async function grade(item: VotedCheck, opus: ClaudeCompVerifier, sonnet: ClaudeCompVerifier): Promise<Graded> {
  // Photos fetched once, then shown to both graders.
  const comps = await Promise.all(item.candidates.map(async (c) => {
    const match = toMatch(c)
    return { ...match, photoUrls: await fetchProductPhotos(match.link, DEALER_PHOTOS) }
  }))
  const input = { listingImageUrls: item.imageUrls, listingTitle: item.title, comps }
  const [a, b] = await Promise.all([opus.tiers(input), sonnet.tiers(input)])
  const tierOf = (graded: typeof a) => comps.map((c) => graded.find((g) => g.comp === c)?.tier ?? 'none')
  const o = tierOf(a)
  const s = tierOf(b)
  return { ...item, opus: o, sonnet: s, consensus: o.map((t, i) => weakerTier(t, s[i])) }
}

const count = (tiers: CompTier[], accepted: CompTier[]) => tiers.filter((t) => accepted.includes(t)).length

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%` : 'n/a'
}

function report(rows: Graded[]): void {
  const good = rows.filter((r) => r.isGood).length
  console.log(`\n${rows.length} voted analyses (${good} 👍 / ${rows.length - good} 👎), base rate ${pct(good, rows.length)}\n`)
  console.log('rule                                   | kept | 👍 | precision | recall')
  console.log('---------------------------------------|------|----|-----------|-------')
  const line = (name: string, keep: (r: Graded) => boolean) => {
    const kept = rows.filter(keep)
    const g = kept.filter((r) => r.isGood).length
    console.log(`${name.padEnd(39)}| ${String(kept.length).padStart(4)} | ${String(g).padStart(2)} | ${pct(g, kept.length).padStart(9)} | ${pct(g, good).padStart(6)}`)
  }
  line('stored binary ≥1', (r) => r.storedConfirmed >= 1)
  line('stored binary ≥2', (r) => r.storedConfirmed >= 2)
  const MODEL: CompTier[] = ['same_model']
  const LINE: CompTier[] = ['same_model', 'same_line']
  const ANY: CompTier[] = ['same_model', 'same_line', 'resemblance']
  for (const who of ['consensus', 'opus', 'sonnet'] as const) {
    line(`${who} same model ≥1`, (r) => count(r[who], MODEL) >= 1)
    line(`${who} same model ≥2`, (r) => count(r[who], MODEL) >= 2)
    line(`${who} model or line ≥1`, (r) => count(r[who], LINE) >= 1)
    line(`${who} model or line ≥2`, (r) => count(r[who], LINE) >= 2)
    line(`${who} any tier ≥2`, (r) => count(r[who], ANY) >= 2)
  }
}

async function main() {
  const since = arg('--since', '2026-10-13')
  const concurrency = Number(arg('--concurrency', '3'))
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
  const opus = new ClaudeCompVerifier(env.ANTHROPIC_API_KEY, 'claude-opus-5-5')
  const sonnet = new ClaudeCompVerifier(env.ANTHROPIC_API_KEY, 'claude-sonnet-5-5')
  const voted = await loadVoted(since)
  console.error(`🧪 Graded comp check — ${voted.length} voted analyses since ${since}, ${voted.length * 2} Claude calls`)
  console.log('listingId,vote,storedConfirmed,consensus,opus,sonnet,title')
  const out: Graded[] = []
  const queue = [...voted]
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const r = await grade(item, opus, sonnet)
        out.push(r)
        const tally = (t: CompTier[]) => `${count(t, ['same_model'])}m/${count(t, ['same_line'])}l/${count(t, ['resemblance'])}r`
        console.log([r.listingId, r.isGood ? 'good' : 'bad', r.storedConfirmed, tally(r.consensus), tally(r.opus), tally(r.sonnet), JSON.stringify(r.title)].join(','))
      } catch (err) {
        console.error(`  failed for ${item.listingId}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }))
  report(out)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
