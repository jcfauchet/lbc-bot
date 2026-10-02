export interface PhotoReferenceSummary {
  id: string
  name: string
  note: string | null
  maxPriceCents: number | null
  isActive: boolean
  createdAt: Date
  imageUrls: string[]
  matchCount: number
  matchedListingUrls: string[]
}
export interface NewPhotoReference { name: string; note: string | null; maxPriceCents: number | null }
export interface ImageToEmbed { id: string; url: string }
export interface ListingToCheck {
  id: string
  title: string
  priceCents: number
  /** First 3 photos, oldest first. */
  images: Array<{ id: string; url: string; hasEmbedding: boolean }>
}
export interface ReferenceCandidate {
  referenceId: string
  name: string
  note: string | null
  maxPriceCents: number | null
  similarity: number
  imageUrls: string[]
}
export interface RecordedMatch { referenceId: string; listingId: string; similarity: number; confirmed: boolean; reason: string | null }
export interface PendingAlert {
  matchId: string
  referenceName: string
  referenceImageUrl: string | null
  listingId: string
  listingTitle: string
  listingUrl: string
  priceCents: number
  city: string | null
  listingImageUrl: string | null
  reason: string | null
}
export interface IReferenceRepository {
  hasActiveReferences(): Promise<boolean>
  create(reference: NewPhotoReference, imageUrls: string[]): Promise<{ id: string; images: ImageToEmbed[] }>
  list(): Promise<PhotoReferenceSummary[]>
  /** False when no reference has this id. */
  setActive(id: string, isActive: boolean): Promise<boolean>
  findReferenceImagesMissingEmbedding(limit: number): Promise<ImageToEmbed[]>
  setReferenceImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  /** Unchecked listings scraped in the last `maxAgeDays`, newest first, not voted down. */
  findListingsToCheck(limit: number, maxAgeDays: number): Promise<ListingToCheck[]>
  setListingImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  /** Active references close to this listing's photos, excluding pairs already judged. */
  findCandidates(listingId: string, minSimilarity: number, limit: number): Promise<ReferenceCandidate[]>
  /** Recent listings (embedded photos, not voted down) close to one reference, excluding pairs already judged. */
  findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number, limit: number): Promise<Array<{ listing: ListingToCheck; candidate: ReferenceCandidate }>>
  /** Active references never backfilled whose photos are all embedded. */
  findReferencesToBackfill(): Promise<string[]>
  markBackfilled(referenceId: string): Promise<void>
  recordMatch(match: RecordedMatch): Promise<void>
  markListingChecked(listingId: string): Promise<void>
  findPendingAlerts(): Promise<PendingAlert[]>
  markNotified(matchId: string): Promise<void>
}
