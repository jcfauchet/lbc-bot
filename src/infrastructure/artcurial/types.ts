export interface ArtcurialSale {
  ref: string
  name: string
  status: string
  totalLots: number
  /** Specialty refs, e.g. 'DESIGN' */
  specialties: string[]
  /** ISO date */
  beginDate: string | null
  /** ISO date; an online sale closes one to two weeks after it begins */
  endDate: string | null
}

export interface ArtcurialLot {
  saleRef: string
  /** e.g. '278-a' */
  lotRef: string
  /** 'SOLD' | 'UNSOLD' | ... */
  status: string
  /** HTML stripped, whitespace collapsed */
  title: string
  description: string
  /** e.g. 'Poul KJAERHOLM' and '1929-1980' */
  artist: string | null
  artistYears: string | null
  estimateLowEur: number | null
  estimateHighEur: number | null
  hammerEur: number | null
  finalEur: number | null
  /** ISO adjudicationDate */
  soldAt: string | null
  /** document.servingUrl (storage.googleapis.com), catalogue order */
  pictureUrls: string[]
}
