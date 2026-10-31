export const ROSSINI_HOUSE_ID = '62'

export interface RossiniSale {
  id: string
  title: string
  /** ISO date (YYYY-MM-DD) or null when the date line cannot be parsed */
  date: string | null
  /** Site-relative catalogue path, e.g. /catalogue/174947-some-slug */
  catalogueUrl: string
}

export interface RossiniLot {
  saleId: string
  lotId: string
  lotNumber: string
  title: string
  description: string
  estimateLowEur: number | null
  estimateHighEur: number | null
  /** Hammer price ("Résultats sans frais"); null when the lot is not sold */
  resultEur: number | null
  /** From cdn.drouot.com/d/lot/(phare|small)/62/<saleId>/<hash>, own sale only, deduplicated */
  photoHashes: string[]
}
