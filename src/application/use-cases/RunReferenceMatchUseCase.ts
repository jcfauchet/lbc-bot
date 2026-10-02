import type { IReferenceRepository, ListingToCheck, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { IReferenceMatchVerifier } from '@/domain/services/IReferenceMatchVerifier'
import type { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'

export interface ReferenceMatchConfig {
  /** Cosine similarity from which Gemini is asked to confirm. Deliberately loose. */
  minSimilarity: number
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
}

export interface ReferenceMatchResult { checked: number; failed: number; judged: number; confirmed: number; alerted: number }

/** Reference photos whose embedding failed at upload, retried per run. */
const REFERENCE_IMAGE_RETRY_BATCH = 20

/** A 4xx on the photo means the ad (or its image) is gone: retrying cannot help. */
function isPermanentImageError(err: unknown): boolean {
  return err instanceof Error && /Image download failed \(4\d\d\)/.test(err.message)
}

interface RunBudget {
  deadline: number
  verificationsLeft: number
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
    private verifier: IReferenceMatchVerifier,
    private mailer: IMailer,
    private config: ReferenceMatchConfig,
    private now: () => number = Date.now,
  ) {}

  async execute(): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    if (!(await this.repo.hasActiveReferences())) return result

    const budget: RunBudget = {
      deadline: this.now() + this.config.maxRunMs,
      verificationsLeft: this.config.maxVerificationsPerRun,
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
        await this.embedListingImages(listing)
        const candidates = await this.repo.findCandidates(listing.id, this.config.minSimilarity, this.config.maxCandidatesPerListing)
        // Not enough verifications left to judge this listing completely: keep it
        // for the next run (its photo embeddings are already stored).
        if (candidates.length > budget.verificationsLeft) break
        for (const candidate of candidates) await this.judge(listing, candidate, budget, result)
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
        await this.judge(listing, candidate, budget, result)
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

  private async embedListingImages(listing: ListingToCheck): Promise<void> {
    const pending = listing.images.filter((i) => !i.hasEmbedding)
    const outcomes = await Promise.allSettled(pending.map(async (image) => {
      await this.repo.setListingImageEmbedding(image.id, await this.embedder.embedImage(image.url))
    }))
    // A dead photo is skipped; anything else (Gemini down, timeout) fails the
    // listing so it is retried while it is still recent.
    const transient = outcomes.find((o): o is PromiseRejectedResult =>
      o.status === 'rejected' && !isPermanentImageError(o.reason))
    if (transient) throw transient.reason
  }

  private async judge(listing: ListingToCheck, candidate: ReferenceCandidate, budget: RunBudget, result: ReferenceMatchResult): Promise<void> {
    if (candidate.maxPriceCents !== null && listing.priceCents > candidate.maxPriceCents) return

    budget.verificationsLeft--
    const verdict = await this.verifier.verify({
      listingImageUrls: listing.images.map((i) => i.url),
      listingTitle: listing.title,
      referenceImageUrls: candidate.imageUrls,
      referenceName: candidate.name,
      referenceNote: candidate.note,
    })
    await this.repo.recordMatch({
      referenceId: candidate.referenceId,
      listingId: listing.id,
      similarity: candidate.similarity,
      confirmed: verdict.same,
      reason: verdict.reason,
    })
    result.judged++
    if (verdict.same) result.confirmed++
  }

  private async sendPendingAlerts(): Promise<number> {
    let sent = 0
    for (const alert of await this.repo.findPendingAlerts()) {
      try {
        const { subject, html } = EmailTemplates.referenceMatch(alert)
        await this.mailer.send({ to: this.config.emailTo, from: this.config.emailFrom, subject, html })
        await this.repo.markNotified(alert.matchId)
        sent++
      } catch (err) {
        console.error(`Reference alert failed for match ${alert.matchId}:`, err)
      }
    }
    return sent
  }
}
