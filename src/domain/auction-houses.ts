/** Auction houses whose sold lots feed the photo-reference fund (auction_lots.house). */
export type AuctionHouse = 'ARTCURIAL' | 'ROSSINI'

/** Display name of each house, as shown in alerts and on the references page. */
export const HOUSE_LABELS: Record<AuctionHouse, string> = { ARTCURIAL: 'Artcurial', ROSSINI: 'Rossini' }
