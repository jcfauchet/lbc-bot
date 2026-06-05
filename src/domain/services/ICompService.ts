export interface CompMatch {
  title: string
  source: string
  link: string
  price?: { value: number; currency: string }
  isValueDomain: boolean
}

export interface CompResult {
  matches: CompMatch[]
}

export interface ICompService {
  readonly providerName: string
  /** Reverse-image search on a public image URL. */
  findComps(imageUrl: string): Promise<CompResult>
}
