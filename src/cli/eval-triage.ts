#!/usr/bin/env node
/**
 * Offline triage eval: replays the CURRENT triage prompt on listings the user
 * already labelled (👍/👎) and reports precision/recall per score threshold.
 *
 * Run BEFORE deploying any prompt change, and compare against the previous run:
 * the labels are the ground truth the funnel is optimising for.
 *
 * Usage:
 *   npx tsx src/cli/eval-triage.ts [--limit 100] [--with-guidance] [--concurrency 3]
 *
 * Notes:
 * - Labels are biased towards listings that reached notification or the
 *   backlog page; absolute numbers matter less than the DELTA between runs.
 * - Costs one vision call per labelled listing (Gemini Flash — cheap).
 */
import { prisma } from '@/infrastructure/prisma/client'
import { container } from '@/infrastructure/di/container'

interface LabelledListing {
  id: string
  title: string
  priceCents: number
  isGood: boolean
  imageUrl: string
}

interface EvalRow extends LabelledListing {
  score: number
}

function parseArgs(): { limit: number; withGuidance: boolean; concurrency: number } {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    limit: Number(get('--limit') ?? 200),
    withGuidance: args.includes('--with-guidance'),
    concurrency: Number(get('--concurrency') ?? 3),
  }
}

async function loadLabelled(limit: number): Promise<LabelledListing[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string
    title: string
    priceCents: number
    isGood: boolean
    imageUrl: string | null
  }>>`
    SELECT l.id, l.title, l."priceCents", f."isGood",
      (SELECT i."urlRemote" FROM "listing_images" i
       WHERE i."listingId" = l.id ORDER BY i."createdAt" ASC LIMIT 1) AS "imageUrl"
    FROM "listing_feedbacks" f
    JOIN "lbc_product_listings" l ON l.id = f."listingId"
    ORDER BY f."createdAt" DESC
    LIMIT ${limit}
  `
  return rows.filter((r): r is typeof r & { imageUrl: string } => Boolean(r.imageUrl))
}

async function scoreAll(
  listings: LabelledListing[],
  guidance: string | null,
  concurrency: number,
): Promise<EvalRow[]> {
  const out: EvalRow[] = []
  let done = 0
  const queue = [...listings]

  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const { score } = await container.triageService.triage(
          { imageUrl: item.imageUrl, title: item.title, priceEur: item.priceCents / 100 },
          guidance,
        )
        out.push({ ...item, score })
      } catch (err) {
        console.error(`  scoring failed for ${item.id}: ${err instanceof Error ? err.message : err}`)
      }
      done++
      if (done % 20 === 0) console.log(`  ...${done}/${listings.length}`)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

function report(rows: EvalRow[]): void {
  const positives = rows.filter((r) => r.isGood).length
  console.log(`\nScored ${rows.length} labelled listings (${positives} 👍 / ${rows.length - positives} 👎)\n`)
  console.log('threshold | pass | precision | recall | f1')
  console.log('----------|------|-----------|--------|-----')
  for (let threshold = 4; threshold <= 10; threshold++) {
    const pass = rows.filter((r) => r.score >= threshold)
    const truePos = pass.filter((r) => r.isGood).length
    const precision = pass.length ? truePos / pass.length : 0
    const recall = positives ? truePos / positives : 0
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
    console.log(
      `    ${String(threshold).padStart(2)}    | ${String(pass.length).padStart(4)} |   ${(precision * 100).toFixed(0).padStart(3)}%    |  ${(recall * 100).toFixed(0).padStart(3)}%  | ${f1.toFixed(2)}`,
    )
  }
  console.log('\nRead: pick the threshold whose precision/recall trade-off fits the comp budget.')
  console.log('Compare runs after any prompt change — the delta is the signal.')
}

async function main() {
  const { limit, withGuidance, concurrency } = parseArgs()
  console.log(`🧪 Triage eval — limit ${limit}, guidance ${withGuidance ? 'ON' : 'OFF'}`)

  const guidance = withGuidance
    ? (await container.triageGuidanceRepository.getLatest())?.content ?? null
    : null
  const labelled = await loadLabelled(limit)
  console.log(`Loaded ${labelled.length} labelled listings with an image.`)

  const rows = await scoreAll(labelled, guidance, concurrency)
  report(rows)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
