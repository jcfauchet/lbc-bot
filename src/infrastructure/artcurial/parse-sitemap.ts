const LOT_LOC = /<loc>(https:\/\/www\.artcurial\.com\/ventes\/([^/<]+)\/lots\/\d+-[^<]+)<\/loc>/g

/** Groups the lot URLs of an Artcurial sales sitemap by sale ref, deduplicated. */
export function parseSitemap(xml: string): { lotUrlsBySale: Map<string, string[]> } {
  const sets = new Map<string, Set<string>>()
  for (const match of xml.matchAll(LOT_LOC)) {
    const [, url, saleRef] = match
    const urls = sets.get(saleRef) ?? new Set<string>()
    urls.add(url)
    sets.set(saleRef, urls)
  }
  const lotUrlsBySale = new Map<string, string[]>()
  for (const [saleRef, urls] of sets) lotUrlsBySale.set(saleRef, [...urls])
  return { lotUrlsBySale }
}
