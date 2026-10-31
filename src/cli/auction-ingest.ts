#!/usr/bin/env node
/**
 * Turns an auction house's sold lots into photo references (hammer price, photos, embeddings).
 *
 * Usage:
 *   pnpm auction:ingest --year 2025 [--house artcurial|rossini|osenat|pba|gros-delettrez] [--sale IT6064] [--limit 50] [--dry-run] [--concurrency 3]
 *
 * --house defaults to artcurial (`pnpm artcurial:ingest` runs the same script).
 * --dry-run only lists the sales that would be ingested. Re-running is safe: lots already stored are skipped.
 * Exits 1 when at least one lot failed.
 */
import { container } from '@/infrastructure/di/container'
import { parseAuctionIngestArgs } from './auction-ingest-args'

async function main() {
  const { house, options } = parseAuctionIngestArgs(process.argv.slice(2))
  const ingester = container.auctionIngesters[house]
  if (!ingester) throw new Error(`no ingester wired for ${house}`)
  const report = await ingester.ingest(options)
  console.log(JSON.stringify(report, null, 2))
  if (report.lotsFailed > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => container.cleanup())
