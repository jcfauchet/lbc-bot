import { stripHtml } from '@/infrastructure/artcurial/parse-lot-page'
import { parseFrenchDate } from '@/infrastructure/drouot/french-date'

export interface AderSalePage {
  id: string
  title: string
  /** ISO date (YYYY-MM-DD) of the sale's first session, or null when the date line cannot be parsed */
  date: string | null
  /** From the "360 lots" heading */
  totalLots: number
  /** Site-relative lot paths of this page, e.g. /l/35353927-etablissements-galle-… */
  lotPaths: string[]
}

/** Lot paths linked from a sale page, without query or fragment, once per lot id, in page order. */
export function parseLotPaths(html: string): string[] {
  const pathsById = new Map<string, string>()
  for (const match of html.matchAll(/href="(\/l\/(\d+)(?:-[^"?#]*)?)["?#]/g)) {
    if (!pathsById.has(match[2])) pathsById.set(match[2], match[1])
  }
  return [...pathsById.values()]
}

/** Null when the page has no sale id, title or lot count (not a sale page, or markup drift). */
export function parseSalePage(html: string): AderSalePage | null {
  const id = /<link rel="canonical" href="[^"]*\/v\/(\d+)-/.exec(html)?.[1]
  const title = stripHtml(/<h1 class="sale-title"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1])
  const lotCount = /class="sale-lots-heading"[^>]*>\s*(\d+)\s+lots?\b/.exec(html)?.[1]
  if (!id || !title || lotCount === undefined) return null
  const facts = /<div class="sale-facts">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const dateLine = stripHtml(/<p>([\s\S]*?)<\/p>/.exec(facts)?.[1])
  return { id, title, date: parseFrenchDate(dateLine), totalLots: Number(lotCount), lotPaths: parseLotPaths(html) }
}
