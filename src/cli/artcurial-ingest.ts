#!/usr/bin/env node
/**
 * Turns Artcurial's sold lots into photo references (hammer price, photos, embeddings).
 *
 * Usage:
 *   pnpm artcurial:ingest --year 2025 [--sale IT6064] [--limit 50] [--dry-run] [--concurrency 3]
 *
 * --dry-run only lists the sales that would be ingested. Re-running is safe: lots already stored are skipped.
 * Exits 1 when at least one lot failed.
 */
import { container } from '@/infrastructure/di/container'
import { ArtcurialFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import { ArtcurialAdapter } from '@/infrastructure/artcurial/ArtcurialAdapter'
import { AuctionIngester } from '@/infrastructure/auction/AuctionIngester'
import { parseArtcurialIngestArgs } from './artcurial-ingest-args'

async function main() {
  const options = parseArtcurialIngestArgs(process.argv.slice(2))
  const adapter = new ArtcurialAdapter(new ArtcurialFetcher(), console.log)
  const ingester = new AuctionIngester(adapter, container.referenceRepository, container.imageEmbeddingService, console.log)
  const report = await ingester.ingest(options)
  console.log(JSON.stringify(report, null, 2))
  if (report.lotsFailed > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => container.cleanup())
