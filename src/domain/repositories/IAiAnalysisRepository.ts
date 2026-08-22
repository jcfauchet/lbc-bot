import { AiAnalysis } from '../entities/AiAnalysis'
import { Listing } from '../entities/Listing'

/**
 * An analysis worth emailing, already joined to everything the email needs.
 * Assembled in one query so the notification run does not re-fetch a listing,
 * its images and its notification history one deal at a time.
 */
export interface NotifiableDeal {
  analysis: AiAnalysis
  listing: Listing
  imageUrl?: string
}

export interface IAiAnalysisRepository {
  save(analysis: AiAnalysis): Promise<AiAnalysis>
  findById(id: string): Promise<AiAnalysis | null>
  findByListingId(listingId: string): Promise<AiAnalysis | null>
  findByMinMargin(minMargin: number): Promise<AiAnalysis[]>
  /**
   * Analyses above `minMargin` whose listing has never been notified, ordered
   * by margin desc. Excluding the already-sent ones in SQL matters: the
   * notification cron runs every 15 minutes over a set that only grows, and
   * the vast majority of it has been emailed weeks ago.
   */
  findNotifiableByMinMargin(minMargin: number): Promise<NotifiableDeal[]>
  findAll(): Promise<AiAnalysis[]>
  update(analysis: AiAnalysis): Promise<AiAnalysis>
  delete(id: string): Promise<void>
}
