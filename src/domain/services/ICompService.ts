export interface CompMatch {
  title: string
  source: string
  link: string
  price?: { value: number; currency: string }
  isValueDomain: boolean
  /**
   * True when the match comes from a mass-produced retail / marketplace domain
   * (Cdiscount, Amazon, Aliexpress…). Several of these mean the piece is a common
   * new product with no resale edge. Optional: absent is treated as false.
   */
  isMassMarket?: boolean
}

export interface CompResult {
  matches: CompMatch[]
}

export interface ICompService {
  readonly providerName: string
  /** Reverse-image search on a public image URL. */
  findComps(imageUrl: string): Promise<CompResult>
}
