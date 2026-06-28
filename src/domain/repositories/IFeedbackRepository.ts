import { ListingFeedback } from '@/domain/entities/ListingFeedback'

export interface SimilarFeedback {
  listingTitle: string
  priceCents: number
  isGood: boolean
  comment?: string
  aiDescription?: string
  similarity: number
}

/** A feedback item digested for the learning routine (vote-neutral). */
export interface FeedbackDigestItem {
  listingTitle: string
  priceCents: number
  comment?: string
  aiDescription?: string
}

export interface IFeedbackRepository {
  save(feedback: ListingFeedback, embedding?: number[]): Promise<ListingFeedback>
  updateEmbedding(id: string, embedding: number[]): Promise<void>
  updateComment(id: string, comment: string): Promise<void>
  findSimilar(embedding: number[], limit: number): Promise<SimilarFeedback[]>
  /** Recent listings the user judged NOT worth it, newest first. */
  findRecentNegative(limit: number): Promise<FeedbackDigestItem[]>
  /** Recent listings the user judged worth it, newest first. */
  findRecentPositive(limit: number): Promise<FeedbackDigestItem[]>
  findByListingId(listingId: string): Promise<ListingFeedback | null>
  findByListingIds(listingIds: string[]): Promise<Map<string, ListingFeedback>>
}
