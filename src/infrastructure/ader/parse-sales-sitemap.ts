export interface AderSitemapSale {
  id: string
  /** Absolute sale page URL, e.g. https://ader-paris.fr/v/161958-cote-xxe */
  url: string
}

/** Sales of a `sitemap-sales-past-<year>-fr-NN.xml` part, in sitemap order, once each. */
export function parseSalesSitemap(xml: string): AderSitemapSale[] {
  const sales = new Map<string, AderSitemapSale>()
  for (const match of xml.matchAll(/<loc>\s*(https?:\/\/[^<\s]*\/v\/(\d+)-[^<\s]*)\s*<\/loc>/g)) {
    if (!sales.has(match[2])) sales.set(match[2], { id: match[2], url: match[1] })
  }
  return [...sales.values()]
}
