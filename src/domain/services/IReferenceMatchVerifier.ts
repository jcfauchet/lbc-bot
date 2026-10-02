export interface ReferenceVerdict { same: boolean; reason: string | null }

export interface ReferenceMatchInput {
  listingImageUrls: string[]
  listingTitle: string
  referenceImageUrls: string[]
  referenceName: string
  referenceNote: string | null
}

/** Decides whether a listing shows the same model/design as a reference piece. */
export interface IReferenceMatchVerifier {
  verify(input: ReferenceMatchInput): Promise<ReferenceVerdict>
}
