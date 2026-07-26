/**
 * Retail / marketplace domains that sell mass-produced, currently-available
 * furniture & decor. When a reverse-image search returns several matches from
 * these, the piece is a common new product with no resale edge — exactly the
 * "объект too common, nobody buys it / trouvé neuf sur les marketplaces"
 * feedback the operator kept flagging (e.g. a "travertin" table found new on
 * Cdiscount at 79€).
 *
 * Deliberately excludes ambiguous second-hand marketplaces (eBay, Etsy, Vinted)
 * where genuine vintage also lives — matching one of those must not, on its own,
 * condemn a listing. Kept to clearly mass-produced-new retail.
 */
export const MASS_MARKET_DOMAINS = [
  'amazon', 'aliexpress', 'temu', 'wish.com', 'shein', 'joom', 'dhgate',
  'cdiscount', 'wayfair', 'ikea', 'maisonsdumonde', 'made.com', 'laredoute',
  'la-redoute', 'manomano', 'vidaxl', 'beliani', 'miliboo', 'gifi', 'but.fr',
  'conforama', 'alinea', 'castorama', 'leroymerlin', 'fnac', 'darty', 'rakuten',
  'kavehome', 'kave.com', 'westwing', 'atmosphera', 'vente-unique', 'rueducommerce',
  'overstock', 'homedepot', 'walmart', 'target.com', 'vidaxl', 'bricodepot',
] as const

export function isMassMarketDomain(urlOrSource: string): boolean {
  const haystack = urlOrSource.toLowerCase()
  return MASS_MARKET_DOMAINS.some((d) => haystack.includes(d))
}
