import type { AuctionHouse } from '@/domain/auction-houses'

export type { AuctionHouse }
/** MANUAL: added by hand. AUCTION: a sold auction lot; its house is in `auction.house`. */
export type ReferenceSource = 'MANUAL' | 'AUCTION'
export interface AuctionLotSummary {
  house: AuctionHouse
  saleRef: string
  lotRef: string
  lotUrl: string
  saleName: string
  soldAt: Date
  title: string
  artist: string | null
  hammerCents: number
  quantity: number
  hammerPerUnitCents: number
}
export interface PhotoReferenceSummary {
  id: string
  name: string
  note: string | null
  maxPriceCents: number | null
  isActive: boolean
  createdAt: Date
  keywords: string[]
  imageUrls: string[]
  matchCount: number
  matchedListingUrls: string[]
}
export interface NewPhotoReference {
  name: string
  note: string | null
  maxPriceCents: number | null
  /** Lower-case words that, found in an ad's text, send it to the verifier regardless of photo similarity. */
  keywords: string[]
}
export interface ImageToEmbed { id: string; url: string }
export interface ListingToCheck {
  id: string
  title: string
  priceCents: number
  /** Every stored photo, cover first. */
  images: Array<{ id: string; url: string; hasEmbedding: boolean }>
}
export interface ReferenceCandidate {
  referenceId: string
  name: string
  note: string | null
  maxPriceCents: number | null
  similarity: number
  /** One of the reference's keywords appears in the ad's title or description. */
  textHit: boolean
  imageUrls: string[]
  source: ReferenceSource
  /** Set when source === 'AUCTION'. */
  auction: AuctionLotSummary | null
}
export interface CandidateGates {
  /** Manual references: similarity ≥ this, or a keyword hit. */
  minSimilarity: number
  /** Auction lots: similarity ≥ minSimilarity, or a keyword hit with similarity ≥ this. */
  keywordMinSimilarity: number
  /** Auction candidates returned at most; manual candidates are never capped. */
  auctionLimit: number
  includeAuction: boolean
}
export interface NewAuctionLot {
  name: string
  note: string
  keywords: string[]
  imageUrls: string[]
  lot: AuctionLotSummary & {
    artistYears: string | null
    description: string
    estimateLowCents: number | null
    estimateHighCents: number | null
    finalCents: number | null
  }
}
export interface AuctionFundStats {
  lots: number
  images: number
  embedded: number
  byHouse: Array<{ house: AuctionHouse; lots: number }>
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
  source: ReferenceSource
  similarity: number
  auction: AuctionLotSummary | null
}
export interface IReferenceRepository {
  /** Auction lots count only when `includeAuction` is set, i.e. when the fund is switched on. */
  hasActiveReferences(includeAuction: boolean): Promise<boolean>
  create(reference: NewPhotoReference, imageUrls: string[]): Promise<{ id: string; images: ImageToEmbed[] }>
  /** Manual references only. */
  list(): Promise<PhotoReferenceSummary[]>
  /** False when no reference has this id. */
  setActive(id: string, isActive: boolean): Promise<boolean>
  findReferenceImagesMissingEmbedding(limit: number): Promise<ImageToEmbed[]>
  setReferenceImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  /** Unchecked listings scraped in the last `maxAgeDays`, newest first, not voted down. */
  findListingsToCheck(limit: number, maxAgeDays: number): Promise<ListingToCheck[]>
  /** Listings created in the last `days` whose cover photo is embedded, not voted down, newest first. */
  findRecentListingsWithEmbeddedCover(days: number, limit: number): Promise<ListingToCheck[]>
  setListingImageEmbedding(imageId: string, embedding: number[]): Promise<void>
  /**
   * Active references close to this listing's photos or named in its text, excluding pairs already judged.
   * Manual candidates come first, then auction lots by keyword hit then similarity.
   */
  findCandidates(listingId: string, gates: CandidateGates): Promise<ReferenceCandidate[]>
  /** Recent listings (not voted down) close to one manual reference or naming it, excluding pairs already judged. */
  findRecentListingsCloseTo(referenceId: string, minSimilarity: number, days: number, limit: number): Promise<Array<{ listing: ListingToCheck; candidate: ReferenceCandidate }>>
  /** Active manual references never backfilled whose photos are all embedded. */
  findReferencesToBackfill(): Promise<string[]>
  markBackfilled(referenceId: string): Promise<void>
  recordMatch(match: RecordedMatch): Promise<void>
  markListingChecked(listingId: string): Promise<void>
  findPendingAlerts(): Promise<PendingAlert[]>
  markNotified(matchId: string): Promise<void>
  /** Null when a lot with the same (house, saleRef, lotRef) already exists. */
  createAuctionLot(input: NewAuctionLot): Promise<{ id: string; images: ImageToEmbed[] } | null>
  /** Lot refs already stored for one sale of an auction house. */
  findExistingLotRefs(house: AuctionHouse, saleRef: string): Promise<Set<string>>
  /** Verifications (recorded matches) of auction references since `since`. */
  countAuctionVerificationsSince(since: Date): Promise<number>
  auctionFundStats(): Promise<AuctionFundStats>
}
