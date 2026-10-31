import { stripHtml } from '../artcurial/parse-lot-page'
import { parseFrenchDate } from './french-date'
import type { DrouotSale } from './types'

const CARD_START = /<div class="calendrier entry[^"]*\bVente(\d+)\b[^"]*"/g

export function parseYearPage(html: string): DrouotSale[] {
  const starts = [...html.matchAll(CARD_START)]
  const sales: DrouotSale[] = []
  starts.forEach((start, i) => {
    const card = html.slice(start.index, starts[i + 1]?.index ?? html.length)
    const title = /<div class="entry-title">([\s\S]*?)<\/div>/.exec(card)
    const catalogueUrl = /<a[^>]*class="lien_lot"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="lien_lot"/.exec(card)
    const dateBlock = /<div class="bloc_vente_date">([\s\S]*?)<\/div>/.exec(card)
    const url = catalogueUrl?.[1] ?? catalogueUrl?.[2]
    if (!title || !url) return
    sales.push({
      id: start[1],
      title: stripHtml(title[1]),
      date: dateBlock ? parseFrenchDate(stripHtml(dateBlock[1])) : null,
      catalogueUrl: url,
    })
  })
  return sales
}
