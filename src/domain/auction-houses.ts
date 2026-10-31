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

/** Display name of a house; the raw code for a house stored in the database but not labelled yet. */
export function houseLabel(house: string): string {
  return HOUSE_LABELS[house as AuctionHouse] ?? house
}
