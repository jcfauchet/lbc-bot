export interface DrouotSale {
  id: string
  title: string
  /** ISO date (YYYY-MM-DD) or null when the date line cannot be parsed */
  date: string | null
  /** Site-relative catalogue path, e.g. /catalogue/174947-some-slug */
  catalogueUrl: string
}

export interface DrouotLot {
  saleId: string
  lotId: string
  lotNumber: string
  title: string
  description: string
  estimateLowEur: number | null
  estimateHighEur: number | null
  /** Price shown on the "Résultat" line; null when the lot is not sold */
  resultEur: number | null
  /** "Résultats avec frais" -> true, "Résultats sans frais" -> false, no label -> null */
  resultIncludesFees: boolean | null
  /** CDN house id of the photos of the lot's own sale (cdn.drouot.com/d/lot/<variant>/<id>/<saleId>/…); null when none */
  photoHostId: string | null
  /** From cdn.drouot.com/d/lot/(phare|small)/<photoHostId>/<saleId>/<hash>, own sale only, deduplicated */
  photoHashes: string[]
}
