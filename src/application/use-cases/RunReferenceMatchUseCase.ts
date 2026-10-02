import type { IReferenceRepository, ListingToCheck, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { IReferenceMatchVerifier } from '@/domain/services/IReferenceMatchVerifier'
import type { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'

export interface ReferenceMatchConfig {
  /** Cosine similarity from which Gemini is asked to confirm. Deliberately loose. */
  minSimilarity: number
  maxListingsPerRun: number
  backfillDays: number
  emailTo: string[]
  emailFrom: string
}

export interface ReferenceMatchResult { checked: number; failed: number; judged: number; confirmed: number; alerted: number }

/** Reference photos whose embedding failed at upload, retried per run. */
const REFERENCE_IMAGE_RETRY_BATCH = 20

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
  ) {}

  async execute(): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    if (!(await this.repo.hasActiveReferences())) return result

    for (const image of await this.repo.findReferenceImagesMissingEmbedding(REFERENCE_IMAGE_RETRY_BATCH)) {
      try {
        await this.repo.setReferenceImageEmbedding(image.id, await this.embedder.embedImage(image.url))
      } catch (err) {
        console.error(`Reference image embedding failed for ${image.id}:`, err)
      }
    }

    for (const listing of await this.repo.findListingsToCheck(this.config.maxListingsPerRun)) {
      // One listing failing (dead image URL, Gemini hiccup) must not stop the run;
      // its marker stays NULL so the next run retries it.
      try {
        await this.embedListingImages(listing)
        for (const candidate of await this.repo.findCandidates(listing.id, this.config.minSimilarity)) {
          await this.judge(listing, candidate, result)
        }
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

  async backfill(referenceId: string): Promise<ReferenceMatchResult> {
    const result: ReferenceMatchResult = { checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 }
    const close = await this.repo.findRecentListingsCloseTo(referenceId, this.config.minSimilarity, this.config.backfillDays)
    for (const { listing, candidate } of close) {
      try {
        await this.judge(listing, candidate, result)
      } catch (err) {
        console.error(`Reference backfill failed for ${listing.id}:`, err)
        result.failed++
      }
    }
    result.alerted = await this.sendPendingAlerts()
    return result
  }

  private async embedListingImages(listing: ListingToCheck): Promise<void> {
    await Promise.all(listing.images.filter((i) => !i.hasEmbedding).map(async (image) => {
      await this.repo.setListingImageEmbedding(image.id, await this.embedder.embedImage(image.url))
    }))
  }

  private async judge(listing: ListingToCheck, candidate: ReferenceCandidate, result: ReferenceMatchResult): Promise<void> {
    if (candidate.maxPriceCents !== null && listing.priceCents > candidate.maxPriceCents) return

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
