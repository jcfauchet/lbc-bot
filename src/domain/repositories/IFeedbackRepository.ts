import { ListingFeedback } from '@/domain/entities/ListingFeedback'

export interface SimilarFeedback {
  listingTitle: string
  priceCents: number
  isGood: boolean
  comment?: string
  aiDescription?: string
  similarity: number
}

export interface IFeedbackRepository {
  save(feedback: ListingFeedback, embedding?: number[]): Promise<ListingFeedback>
  updateEmbedding(id: string, embedding: number[]): Promise<void>
  updateComment(id: string, comment: string): Promise<void>
  findSimilar(embedding: number[], limit: number): Promise<SimilarFeedback[]>
  findByListingId(listingId: string): Promise<ListingFeedback | null>
  findByListingIds(listingIds: string[]): Promise<Map<string, ListingFeedback>>
}
