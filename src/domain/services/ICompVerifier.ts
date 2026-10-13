import type { CompMatch } from './ICompService'

export interface CompVerifyInput {
  listingImageUrl: string
  listingTitle: string
  comps: CompMatch[]
}

/** Looks at the ad photo next to each comparable and keeps the ones showing the same model. */
export interface ICompVerifier {
  verify(input: CompVerifyInput): Promise<CompMatch[]>
}
