import type { CompMatch } from './ICompService'

export interface CompVerifyInput {
  /** The ad's photos, cover first. Detail shots (feet, joints, maker's mark) tell a model from a look-alike. */
  listingImageUrls: string[]
  listingTitle: string
  comps: CompMatch[]
}

/** Looks at the ad photos next to each comparable and keeps the ones showing the same model. */
export interface ICompVerifier {
  verify(input: CompVerifyInput): Promise<CompMatch[]>
}
