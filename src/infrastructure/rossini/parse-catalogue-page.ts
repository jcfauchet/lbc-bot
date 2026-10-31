/** Lot links look like /lot/<saleId>/<lotId>-<slug>; they are normalised to /lot/<saleId>/<lotId>. */
export function parseCataloguePage(html: string): { lotUrls: string[]; total: number } {
  const lotUrls = new Set<string>()
  for (const match of html.matchAll(/href="(?:https:\/\/www\.rossini\.fr)?\/lot\/(\d+)\/(\d+)[^"]*"/g)) {
    lotUrls.add(`/lot/${match[1]}/${match[2]}`)
  }
  const total = /Lots\s+\d+\s+à\s+\d+\s+sur\s+([\d\s ]+)/.exec(html)
  return { lotUrls: [...lotUrls], total: total ? Number(total[1].replace(/[\s ]/g, '')) : 0 }
}
