export interface AderSitemapSale {
  id: string
  /** Absolute sale page URL, e.g. https://ader-paris.fr/v/161958-cote-xxe */
  url: string
  /** The entry's `<lastmod>` as written (ISO date-time), or null when it has none. */
  lastmod: string | null
}

/** Sales of a `sitemap-sales-past-<year>-fr-NN.xml` part, in sitemap order, once each. */
export function parseSalesSitemap(xml: string): AderSitemapSale[] {
  const sales = new Map<string, AderSitemapSale>()
  for (const block of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*(https?:\/\/[^<\s]*\/v\/(\d+)-[^<\s]*)\s*<\/loc>/.exec(block[1])
    if (!loc || sales.has(loc[2])) continue
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block[1])?.[1] ?? null
    sales.set(loc[2], { id: loc[2], url: loc[1], lastmod })
  }
  return [...sales.values()]
}
