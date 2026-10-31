import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import type { HouseAdapter, HouseSale } from '@/infrastructure/auction/HouseAdapter'
import type { PageFetcher } from './ArtcurialFetcher'
import { parseLotPage } from './parse-lot-page'
import { parseSalePage } from './parse-sale-page'
import { parseSitemap } from './parse-sitemap'
import { isWantedSale, toAuctionReference } from './to-auction-reference'
import type { ArtcurialSale } from './types'

/**
 * Artcurial: the yearly sitemap lists every lot URL grouped by sale, each sale page
 * carries its status, dates and specialties, each lot page its result (Nuxt payload).
 */
export class ArtcurialAdapter implements HouseAdapter {
  readonly house = 'ARTCURIAL' as const
  /** Lot URLs of the last fetched sitemap, by sale ref. */
  private lotUrlsBySale = new Map<string, string[]>()
  /** Full sale pages of the listed sales, needed to build each lot's reference. */
  private salesByRef = new Map<string, ArtcurialSale>()

  constructor(
    private readonly fetcher: PageFetcher,
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** Fetches the sitemap once, then one sale page per asked-for sale in sitemap order, yielding the wanted ones. */
  async *listSales(year: number, filter: { saleRef?: string }): AsyncGenerator<HouseSale> {
    const { lotUrlsBySale } = parseSitemap(await this.fetcher.fetchText(`https://www.artcurial.com/sitemap/sales-${year}-fr.xml`))
    this.lotUrlsBySale = lotUrlsBySale
    this.salesByRef = new Map()
    for (const saleRef of lotUrlsBySale.keys()) {
      if (filter.saleRef && saleRef !== filter.saleRef) continue
      const sale = await this.loadWantedSale(saleRef)
      if (!sale) continue
      this.salesByRef.set(saleRef, sale)
      yield {
        ref: saleRef,
        name: sale.name,
        closedAt: sale.endDate ?? sale.beginDate,
        finished: sale.status === 'FINISHED',
        totalLots: sale.totalLots,
        label: sale.specialties.join(','),
      }
    }
  }

  async listLotUrls(sale: HouseSale): Promise<string[]> {
    return this.lotUrlsBySale.get(sale.ref) ?? []
  }

  /** '.../lots/278-a' -> '278-a', the lotRef stored in auction_lots. */
  lotRefFromUrl(url: string): string {
    const tail = url.slice(url.lastIndexOf('/') + 1)
    try { return decodeURIComponent(tail) } catch { return tail }
  }

  async fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null> {
    const artcurialSale = this.salesByRef.get(sale.ref)
    if (!artcurialSale) throw new Error(`sale ${sale.ref} was not listed`)
    const lot = parseLotPage(await this.fetcher.fetchText(url))
    if (!lot) throw new Error('unparseable lot page')
    return toAuctionReference(lot, artcurialSale, url)
  }

  private async loadWantedSale(saleRef: string): Promise<ArtcurialSale | null> {
    try {
      const sale = parseSalePage(await this.fetcher.fetchText(`https://www.artcurial.com/ventes/${saleRef}`))
      return sale && isWantedSale(sale) ? sale : null
    } catch (error) {
      this.log(`sale ${saleRef} skipped: ${(error as Error).message}`)
      return null
    }
  }
}
