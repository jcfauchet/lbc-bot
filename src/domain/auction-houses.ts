/** Auction houses whose sold lots feed the photo-reference fund (auction_lots.house). */
export type AuctionHouse = 'ARTCURIAL' | 'ROSSINI' | 'OSENAT' | 'PBA' | 'GROS_DELETTREZ' | 'ADER'

/** Display name of each house, as shown in alerts and on the references page. */
export const HOUSE_LABELS: Record<AuctionHouse, string> = {
  ARTCURIAL: 'Artcurial',
  ROSSINI: 'Rossini',
  OSENAT: 'Osenat',
  PBA: 'PBA',
  GROS_DELETTREZ: 'Gros & Delettrez',
  ADER: 'Ader',
}

/** CLI slug of each house (`--house <slug>`), the single source for every command's argument parsing. */
export const HOUSE_SLUGS: Record<string, AuctionHouse> = {
  rossini: 'ROSSINI',
  osenat: 'OSENAT',
  pba: 'PBA',
  'gros-delettrez': 'GROS_DELETTREZ',
  ader: 'ADER',
  artcurial: 'ARTCURIAL',
}

/**
 * Order in which the daily cron ingests houses: the cheapest fetches first, so a
 * slow house late in the list cannot starve the quick ones of the shared budget.
 */
export const CRON_HOUSE_ORDER: AuctionHouse[] = ['ROSSINI', 'OSENAT', 'PBA', 'GROS_DELETTREZ', 'ADER', 'ARTCURIAL']

/** Display name of a house; the raw code for a house stored in the database but not labelled yet. */
export function houseLabel(house: string): string {
  return HOUSE_LABELS[house as AuctionHouse] ?? house
}
