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

/** What the ad says about the piece; providers that search by text use it, image-only ones ignore it. */
export interface CompContext {
  title: string
  description?: string | null
  priceEur: number
}

export interface ICompService {
  readonly providerName: string
  /** Comparable sales for the piece on a public image URL, with the ad's text when the provider can use it. */
  findComps(imageUrl: string, context?: CompContext): Promise<CompResult>
}
