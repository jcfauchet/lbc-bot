import type { IReferenceRepository, ListingToCheck, PendingAlert, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { IReferenceMatchVerifier, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'
import type { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'

export interface ReferenceMatchConfig {
  /** Cosine similarity from which Gemini is asked to confirm; a keyword hit skips this gate. */
  minSimilarity: number
  /**
   * Cosine similarity of the cover from which the ad's other photos get embedded.
   * Below it the ad costs one embedding; the verifier is never reached.
   */
  widenSimilarity: number
  maxListingsPerRun: number
  /** Listings older than this are neither checked nor backfilled: the ad is mostly gone. */
  backfillDays: number
  emailTo: string[]
  emailFrom: string
  /**
   * The stage runs first in a cron shared with prefilter/triage/comp/notify.
   * Past this, it stops taking work so the deal funnel still gets its time.
   */
  maxRunMs: number
  /** Gemini vision calls per run; also keeps clear of triage's per-model quota. */
  maxVerificationsPerRun: number
  maxCandidatesPerListing: number
  /** Close recent listings judged when a reference is first backfilled. */
  maxBackfillPerReference: number
  /** Auction lots are offered as candidates only when this is on. */
  auctionEnabled: boolean
  /** An auction lot is worth checking only when its per-unit hammer is at least the ad price times this. */
  auctionAlertRatio: number
  /** Auction verifications per UTC day, across runs: the fund must not eat the Gemini budget. */
  auctionVerificationsPerDay: number
  /**
   * Similarity from which an auction lot is verified. Higher than the manual gate:
   * with ~15k lots the 0.78 gate gave ~5 candidates per ad in the 30 Oct 2026 eval.
   */
  auctionMinSimilarity: number
}

export interface ReferenceMatchVerifiers {
  /** The reseller's own references. */
  manual: IReferenceMatchVerifier
  /** Auction lots: Gemini only, never Claude. */
  auction: IReferenceMatchVerifier
}

export interface ReferenceMatchResult { checked: number; failed: number; judged: number; confirmed: number; alerted: number }

/** Reference photos whose embedding failed at upload, retried per run. */
const REFERENCE_IMAGE_RETRY_BATCH = 20
/** Cover plus three: enough angles to decide, bounded vision tokens per call. */
export const VERIFIER_LISTING_PHOTOS = 4
/** Every reference photo is inlined in the vision call: an auction lot can carry a dozen. */
const VERIFIER_REFERENCE_PHOTOS = 4

/** A 4xx on the photo means the ad (or its image) is gone: retrying cannot help. */
function isPermanentImageError(err: unknown): boolean {
  return err instanceof Error && /Image download failed \(4\d\d\)/.test(err.message)
}

function startOfUtcDay(ms: number): Date {
  const d = new Date(ms)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

interface RunBudget {
  deadline: number
  verificationsLeft: number
  /** What remains of today's auction cap. */
  auctionLeft: number
}

/**
 * Spots ads showing a piece the reseller uploaded as a reference, and alerts her
 * immediately. Runs before prefilter/triage on purpose: a reference match must
 * not depend on the triage score or on the comp budget.
 */
export class RunReferenceMatchUseCase {
  constructor(
    private repo: IReferenceRepository,
    private embedder: IImageEmbeddingService,
    private verifiers: ReferenceMatchVerifiers,
    private mailer: IMailer,
    private config: ReferenceMatchConfig,
    private now: () => number = Date.now,
  ) {}

  async execute(): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    if (!(await this.repo.hasActiveReferences(this.config.auctionEnabled))) return result

    const budget: RunBudget = {
      deadline: this.now() + this.config.maxRunMs,
      verificationsLeft: this.config.maxVerificationsPerRun,
      auctionLeft: this.config.auctionEnabled
        ? Math.max(0, this.config.auctionVerificationsPerDay
          - await this.repo.countAuctionVerificationsSince(startOfUtcDay(this.now())))
        : 0,
    }

    for (const image of await this.repo.findReferenceImagesMissingEmbedding(REFERENCE_IMAGE_RETRY_BATCH)) {
      try {
        await this.repo.setReferenceImageEmbedding(image.id, await this.embedder.embedImage(image.url))
      } catch (err) {
        console.error(`Reference image embedding failed for ${image.id}:`, err)
      }
    }

    // Done here rather than in the upload request: it can take minutes, and the
    // repository only returns references whose photos are all embedded, so a
    // reference whose embedding failed at upload still gets its backfill later.
    for (const referenceId of await this.repo.findReferencesToBackfill()) {
      if (this.isSpent(budget)) break
      if (await this.backfill(referenceId, budget, result)) await this.repo.markBackfilled(referenceId)
    }

    for (const listing of await this.repo.findListingsToCheck(this.config.maxListingsPerRun, this.config.backfillDays)) {
      if (this.isSpent(budget)) break
      // One listing failing (Gemini hiccup) must not stop the run; its marker
      // stays NULL so the next run retries it.
      try {
        const candidates = await this.findCandidatesInStages(listing)
        // Not enough verifications left to judge this listing completely: keep it
        // for the next run (its photo embeddings are already stored).
        if (candidates.length > budget.verificationsLeft) break
        let complete = true
        for (const candidate of candidates) {
          if (!(await this.judge(listing, candidate, budget, result))) complete = false
        }
        // Today's auction cap is spent with lots still unjudged: the manual ones
        // are done, the listing stays unchecked so tomorrow's runs judge the lots.
        if (!complete) continue
        await this.repo.markListingChecked(listing.id)
        result.checked++
      } catch (err) {
        console.error(`Reference matching failed for ${listing.id}:`, err)
        result.failed++
      }
    }

    result.alerted = await this.sendPendingAlerts()
    return result
  }

  /** Returns true when every close listing was judged. */
  private async backfill(referenceId: string, budget: RunBudget, result: ReferenceMatchResult): Promise<boolean> {
    const close = await this.repo.findRecentListingsCloseTo(
      referenceId, this.config.minSimilarity, this.config.backfillDays, this.config.maxBackfillPerReference)
    for (const { listing, candidate } of close) {
      if (this.isSpent(budget)) return false
      try {
        if (!(await this.judge(listing, candidate, budget, result))) return false
      } catch (err) {
        console.error(`Reference backfill failed for ${listing.id}:`, err)
        result.failed++
        return false
      }
    }
    return true
  }

  private isSpent(budget: RunBudget): boolean {
    return this.now() >= budget.deadline || budget.verificationsLeft <= 0
  }

  /**
   * Cover first; the other photos only once a reference comes close to the cover
   * or is named in the ad. Keeps the embedding spend near one call per ad while
   * a match can still surface from a detail shot.
   */
  private async findCandidatesInStages(listing: ListingToCheck): Promise<ReferenceCandidate[]> {
    const [cover, ...others] = listing.images
    await this.embedListingImages(cover ? [cover] : [])
    let candidates = await this.findWideCandidates(listing)
    if (candidates.length === 0) return []
    if (others.some((i) => !i.hasEmbedding)) {
      await this.embedListingImages(others)
      candidates = await this.findWideCandidates(listing)
    }
    const { minSimilarity, widenSimilarity, auctionMinSimilarity } = this.config
    return candidates.filter((c) => c.source !== 'MANUAL'
      // Thousands of lots share generic words: a keyword alone is not enough.
      ? c.similarity >= auctionMinSimilarity || (c.textHit && c.similarity >= widenSimilarity)
      : c.textHit || c.similarity >= minSimilarity)
  }

  private findWideCandidates(listing: ListingToCheck): Promise<ReferenceCandidate[]> {
    return this.repo.findCandidates(listing.id, {
      minSimilarity: this.config.widenSimilarity,
      keywordMinSimilarity: this.config.widenSimilarity,
      auctionLimit: this.config.maxCandidatesPerListing,
      includeAuction: this.config.auctionEnabled,
    })
  }

  private async embedListingImages(images: ListingToCheck['images']): Promise<void> {
    const pending = images.filter((i) => !i.hasEmbedding)
    const outcomes = await Promise.allSettled(pending.map(async (image) => {
      await this.repo.setListingImageEmbedding(image.id, await this.embedder.embedImage(image.url))
    }))
    // A dead photo is skipped; anything else (Gemini down, timeout) fails the
    // listing so it is retried while it is still recent.
    const transient = outcomes.find((o): o is PromiseRejectedResult =>
      o.status === 'rejected' && !isPermanentImageError(o.reason))
    if (transient) throw transient.reason
  }

  /** False when the candidate was left unjudged because today's auction cap is spent. */
  private async judge(listing: ListingToCheck, candidate: ReferenceCandidate, budget: RunBudget, result: ReferenceMatchResult): Promise<boolean> {
    let verifier: IReferenceMatchVerifier
    if (candidate.source !== 'MANUAL') {
      // Never handed to the manual verifier: that one may call Claude.
      if (!candidate.auction) return true
      // Rounded to whole cents so a ratio like 1.1 cannot tip the boundary by a float error.
      const minHammerCents = Math.round(listing.priceCents * this.config.auctionAlertRatio)
      if (minHammerCents > candidate.auction.hammerPerUnitCents) return true
      if (budget.auctionLeft <= 0) return false
      budget.auctionLeft--
      verifier = this.verifiers.auction
    } else {
      if (candidate.maxPriceCents !== null && listing.priceCents > candidate.maxPriceCents) return true
      verifier = this.verifiers.manual
    }

    budget.verificationsLeft--
    let verdict: ReferenceVerdict
    try {
      verdict = await verifier.verify({
        listingImageUrls: listing.images.slice(0, VERIFIER_LISTING_PHOTOS).map((i) => i.url),
        listingTitle: listing.title,
        referenceImageUrls: candidate.imageUrls.slice(0, VERIFIER_REFERENCE_PHOTOS),
        referenceName: candidate.name,
        referenceNote: candidate.note,
      })
    } catch (err) {
      // A dead reference photo would fail this listing on every run and block
      // its other candidates: settle the pair as unconfirmed instead.
      if (!isPermanentImageError(err)) throw err
      verdict = { same: false, reason: 'reference image unavailable' }
    }
    await this.repo.recordMatch({
      referenceId: candidate.referenceId,
      listingId: listing.id,
      similarity: candidate.similarity,
      confirmed: verdict.same,
      reason: verdict.reason,
    })
    result.judged++
    if (verdict.same) result.confirmed++
    return true
  }

  /** Returns the number of emails sent: one per manual match, one per ad for auction lots. */
  private async sendPendingAlerts(): Promise<number> {
    let sent = 0
    const auctionByListing = new Map<string, PendingAlert[]>()
    for (const alert of await this.repo.findPendingAlerts()) {
      if (alert.source !== 'MANUAL') {
        auctionByListing.set(alert.listingId, [...(auctionByListing.get(alert.listingId) ?? []), alert])
        continue
      }
      try {
        const { subject, html } = EmailTemplates.referenceMatch(alert)
        await this.mailer.send({ to: this.config.emailTo, from: this.config.emailFrom, subject, html })
        await this.repo.markNotified(alert.matchId)
        sent++
      } catch (err) {
        console.error(`Reference alert failed for match ${alert.matchId}:`, err)
      }
    }
    for (const [listingId, group] of auctionByListing) {
      try {
        const { subject, html } = EmailTemplates.auctionMatch([...group].sort((a, b) => b.similarity - a.similarity))
        await this.mailer.send({ to: this.config.emailTo, from: this.config.emailFrom, subject, html })
        for (const alert of group) await this.repo.markNotified(alert.matchId)
        sent++
      } catch (err) {
        console.error(`Auction alert failed for listing ${listingId}:`, err)
      }
    }
    return sent
  }
}
