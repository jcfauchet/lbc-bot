/**
 * Lot links look like /lot/<saleId>/<lotId>-<slug>; they are normalised to /lot/<saleId>/<lotId>.
 * Links to another sale than `saleId` are ignored.
 */
export function parseCataloguePage(html: string, saleId: string): { lotUrls: string[]; total: number } {
  const lotUrls = new Set<string>()
  // Relative or absolute (any host) links; the sale id guard is what keeps other sales out.
  for (const match of html.matchAll(/href="(?:https?:\/\/[^\/"]+)?\/lot\/(\d+)\/(\d+)[^"]*"/g)) {
    if (match[1] === saleId) lotUrls.add(`/lot/${match[1]}/${match[2]}`)
  }
  const total = /Lots\s+\d+\s+à\s+\d+\s+sur\s+([\d\s ]+)/.exec(html)
  return { lotUrls: [...lotUrls], total: total ? Number(total[1].replace(/[\s ]/g, '')) : 0 }
}
