import type { AuctionHouse } from '@/domain/auction-houses'

/** One auction house running on the Drouot-platform site template (year results page, catalogue, lot pages). */
export interface DrouotHouseConfig {
  house: AuctionHouse
  /** Site root without a trailing slash, e.g. 'https://www.rossini.fr' */
  baseUrl: string
  /** Path of the year results page, read as `${baseUrl}/${resultsPath}?year=YYYY` */
  resultsPath: string
  /** Buyer's premium used to derive the hammer from a fee-inclusive result. */
  premiumRate: number
  /** Used when a sold lot shows no "Résultats avec/sans frais" label. */
  resultIncludesFeesByDefault: boolean
  /** A sale is kept when its title matches. */
  wantedTitle: RegExp
  /** Vetoes a kept title, except one naming "mobilier" or "objets d'art" (see isWantedSale). */
  unwantedTitle?: RegExp
  /** Lot-level concurrency hint for the ingest. */
  concurrency: number
}

/**
 * Watch, jewellery, wine, book, coin, poster, fashion, car and toy sales. Word-bounded so
 * "mode" does not veto "Art Moderne" nor "vins" a "Provins" sale.
 */
export const UNWANTED_TITLE =
  /\b(?:montres?|horlogerie|bijoux|joaillerie|vins?|spiritueux|numismatique|monnaies|timbres|autographes|livres|affiches|photographies?|mode|maroquinerie|automobiles?|jouets)\b/i

export type DrouotHouse = 'ROSSINI' | 'OSENAT' | 'PBA' | 'GROS_DELETTREZ'

// Keep regexes are drafted from the 2025/2026 sale titles seen in the recon; the rollout
// dry run of each house lists the kept sales and the regex is corrected before the real ingest.
export const DROUOT_HOUSES: Record<DrouotHouse, DrouotHouseConfig> = {
  ROSSINI: {
    house: 'ROSSINI',
    baseUrl: 'https://www.rossini.fr',
    resultsPath: 'resultats',
    premiumRate: 0,
    resultIncludesFeesByDefault: false,
    // Furniture / design / interiors. The spec's drop list (numismatique, bijoux, montres, livres,
    // affiches, ...) only applies when no kept word is present, and a title with no kept word is
    // rejected anyway, so the keep rule alone implements it ("Livres, Timbres, Mobilier, Objets
    // d'Art & Arts de la Table" is kept by "mobilier").
    // "Arts de la table" alone is not kept: on 31 Oct 2026 it matched a wine and spirits
    // sale whose cognac bottles became references. Mixed sales still qualify through
    // the other words ("Livres, Timbres, Mobilier, Objets d'Art & Arts de la Table").
    wantedTitle: /mobilier|objets? d.art|intérieurs?|design|classiques de rossini|collections classiques/i,
    unwantedTitle: UNWANTED_TITLE,
    concurrency: 3,
  },
  OSENAT: {
    house: 'OSENAT',
    baseUrl: 'https://www.osenat.com',
    resultsPath: 'resultats-ventes-passees',
    premiumRate: 0.28,
    resultIncludesFeesByDefault: true,
    wantedTitle: /mobilier|objets? d.art|intérieurs?|esprit du xi?xe|grands siècles|empire|royauté|design|arts? décoratifs/i,
    unwantedTitle: UNWANTED_TITLE,
    concurrency: 3,
  },
  PBA: {
    house: 'PBA',
    baseUrl: 'https://www.pba-auctions.com',
    resultsPath: 'resultats',
    premiumRate: 0.3,
    resultIncludesFeesByDefault: true,
    // No bare "collection": it kept "Montres de collection" and the like.
    wantedTitle: /intérieur|appartements|mobilier|objets? d.art|design|arts? décoratifs/i,
    unwantedTitle: UNWANTED_TITLE,
    // PBA answered 429 during the recon: one lot at a time.
    concurrency: 1,
  },
  GROS_DELETTREZ: {
    house: 'GROS_DELETTREZ',
    baseUrl: 'https://www.gros-delettrez.com',
    resultsPath: 'resultats',
    premiumRate: 0.3,
    resultIncludesFeesByDefault: true,
    wantedTitle: /arts? décoratifs|mobilier|objets? d.art|design/i,
    unwantedTitle: UNWANTED_TITLE,
    concurrency: 3,
  },
}
