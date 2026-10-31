import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import type { PageFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import type { HouseAdapter, HouseSale } from '@/infrastructure/auction/HouseAdapter'
import { isWantedSale } from './is-wanted-sale'
import { parseCataloguePage } from './parse-catalogue-page'
import { parseLotPage } from './parse-lot-page'
import { parseYearPage } from './parse-year-page'
import { toAuctionReference } from './to-auction-reference'
import type { RossiniSale } from './types'

const BASE_URL = 'https://www.rossini.fr'
const PAGE_SIZE = 50
const MIN_SALE_LOTS = 5
/** 2 000 lots: far above any real sale, it only bounds the fetches when the parsed total is bogus. */
const MAX_CATALOGUE_PAGES = 40

/**
 * Rossini: the year results page lists the sales, each catalogue (paged by 50) lists its
 * lot URLs and its total, each lot page carries the hammer price and the photos.
 */
export class RossiniAdapter implements HouseAdapter {
  readonly house = 'ROSSINI' as const
  /** Sales yielded by the last listSales, needed to build each lot's reference. */
  private salesById = new Map<string, RossiniSale>()

  constructor(
    private readonly fetcher: PageFetcher,
    private readonly log: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  async *listSales(year: number, filter: { saleRef?: string }): AsyncGenerator<HouseSale> {
    const sales = parseYearPage(await this.fetcher.fetchText(`${BASE_URL}/resultats?year=${year}`))
    this.salesById = new Map()
    const today = new Date(this.now()).toISOString().slice(0, 10)
    for (const sale of sales) {
      if (filter.saleRef && sale.id !== filter.saleRef) continue
      if (!isWantedSale({ title: sale.title })) continue
      this.salesById.set(sale.id, sale)
      yield {
        ref: sale.id,
        name: sale.title,
        closedAt: sale.date,
        finished: sale.date !== null && sale.date <= today,
        // Unknown until the catalogue is read; listLotUrls applies the minimum-lots rule.
        totalLots: 0,
        label: sale.title,
      }
    }
  }

  async listLotUrls(sale: HouseSale): Promise<string[]> {
    const urls = new Set<string>()
    let total = 0
    for (let offset = 0; offset === 0 || offset < total; offset += PAGE_SIZE) {
      if (offset >= MAX_CATALOGUE_PAGES * PAGE_SIZE) {
        this.log(`sale ${sale.ref} catalogue capped at ${MAX_CATALOGUE_PAGES} pages (total ${total})`)
        break
      }
      const page = parseCataloguePage(
        await this.fetcher.fetchText(`${BASE_URL}/catalogue/${sale.ref}?lang=fr&search=&offset=${offset}&max=${PAGE_SIZE}`),
        sale.ref,
      )
      if (offset === 0) {
        // Markup drift: thrown so the ingester skips the sale instead of keeping it with no lots.
        if (page.total === 0) throw new Error('catalogue total not found')
        if (page.total < MIN_SALE_LOTS) return []
        total = page.total
      }
      for (const path of page.lotUrls) urls.add(`${BASE_URL}${path}`)
    }
    return [...urls]
  }

  /** '.../lot/186362/34122319' -> '34122319', the lotRef stored in auction_lots. */
  lotRefFromUrl(url: string): string {
    return url.slice(url.lastIndexOf('/') + 1)
  }

  async fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null> {
    const rossiniSale = this.salesById.get(sale.ref)
    if (!rossiniSale) throw new Error(`sale ${sale.ref} was not listed`)
    const lot = parseLotPage(await this.fetcher.fetchText(url))
    if (!lot) throw new Error('unparseable lot page')
    if (lot.saleId !== rossiniSale.id) throw new Error(`lot page belongs to sale ${lot.saleId}, not ${rossiniSale.id}`)
    return toAuctionReference(lot, rossiniSale)
  }
}
