#!/usr/bin/env node
/**
 * Replays recent ads against the auction fund to calibrate the similarity
 * threshold and the price ratio on real data. Read-only: nothing is recorded.
 *
 * Usage:
 *   npx tsx src/cli/eval-auction-references.ts [--days 14] [--thresholds 0.75,0.78,0.8] [--verify 0] [--house artcurial|rossini|osenat|pba|gros-delettrez|ader|all]
 *
 * Pairs already judged by the matching stage (rows in reference_matches) are
 * excluded by findCandidates, so they are missing from every count.
 *
 * --verify N runs the Gemini verifier on the first N price-gated pairs at the
 * default threshold (one Gemini call each).
 *
 * --house keeps only the auction candidates of one house (default all).
 */
import { container } from '@/infrastructure/di/container'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'
import { GeminiReferenceMatchVerifier } from '@/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier'
import type { ListingToCheck, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'
import { VERIFIER_LISTING_PHOTOS } from '@/application/use-cases/RunReferenceMatchUseCase'
import { parseEvalAuctionReferencesArgs } from './eval-auction-references-args'

const MAX_LISTINGS = 500
const AUCTION_LIMIT = 3
const eur = (cents: number) => `${Math.round(cents / 100)}EUR`

/** Same price gate as the production use case. */
const passesPriceGate = (listing: ListingToCheck, c: ReferenceCandidate) =>
  c.auction !== null && Math.round(listing.priceCents * env.AUCTION_ALERT_RATIO) <= c.auction.hammerPerUnitCents

async function main() {
  const { days, verify, thresholds, house } = parseEvalAuctionReferencesArgs(process.argv.slice(2))
  const repo = container.referenceRepository
  const listings = await repo.findRecentListingsWithEmbeddedCover(days, MAX_LISTINGS)
  console.log('Note: pairs already judged by the matching stage are excluded from every count.')
  console.log(`${listings.length} listings from the last ${days} days with an embedded cover; ratio ${env.AUCTION_ALERT_RATIO}; house ${house}`)

  const defaultThreshold = env.REFERENCE_MATCH_MIN_SIMILARITY
  const gatedPairs: Array<{ listing: ListingToCheck; candidate: ReferenceCandidate }> = []

  for (const minSimilarity of thresholds) {
    let withCandidate = 0
    let total = 0
    let gated = 0
    const timings: number[] = []
    for (const listing of listings) {
      const started = Date.now()
      const candidates = (await repo.findCandidates(listing.id, {
        minSimilarity,
        keywordMinSimilarity: env.REFERENCE_MATCH_WIDEN_SIMILARITY,
        auctionLimit: AUCTION_LIMIT,
        includeAuction: true,
      })).filter((c) => c.source !== 'MANUAL' && (house === 'all' || c.auction?.house === house))
      timings.push(Date.now() - started)
      if (candidates.length > 0) withCandidate++
      total += candidates.length
      for (const candidate of candidates) {
        if (!passesPriceGate(listing, candidate)) continue
        gated++
        if (minSimilarity === defaultThreshold && gatedPairs.length < verify) gatedPairs.push({ listing, candidate })
      }
    }
    const avg = timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0
    const max = timings.length ? Math.max(...timings) : 0
    console.log(
      `threshold ${minSimilarity}: ${withCandidate} listings with >=1 auction candidate, ${total} candidates, ${gated} pass the price ratio; findCandidates avg ${avg} ms, max ${max} ms`,
    )
  }

  if (verify > 0) {
    if (!thresholds.includes(defaultThreshold)) console.log(`--verify needs the default threshold ${defaultThreshold} in --thresholds; nothing verified`)
    const verifier = new GeminiReferenceMatchVerifier(env.GOOGLE_GEMINI_API_KEY ?? '')
    for (const { listing, candidate } of gatedPairs) {
      const auction = candidate.auction!
      const row = await prisma.lbcProductListing.findUnique({ where: { id: listing.id }, select: { url: true } })
      try {
        const verdict = await verifier.verify({
          listingImageUrls: listing.images.slice(0, VERIFIER_LISTING_PHOTOS).map((i) => i.url),
          listingTitle: listing.title,
          referenceImageUrls: candidate.imageUrls,
          referenceName: candidate.name,
          referenceNote: candidate.note,
        })
        console.log([
          verdict.same ? 'SAME' : 'DIFFERENT', auction.house, candidate.similarity.toFixed(3), `ad ${eur(listing.priceCents)}`,
          `hammer/unit ${eur(auction.hammerPerUnitCents)}`, row?.url ?? listing.id, auction.lotUrl,
        ].join(' | '))
      } catch (err) {
        console.log(`ERROR | ${auction.house} | ${candidate.similarity.toFixed(3)} | ${row?.url ?? listing.id} | ${auction.lotUrl} | ${err instanceof Error ? err.message : err}`)
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => container.cleanup())
