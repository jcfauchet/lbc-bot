import type { AuctionHouse } from '@/domain/auction-houses'
import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'

export interface HouseSale {
  /** saleRef stored in auction_lots */
  ref: string
  name: string
  /** ISO date of the day results are final (end date for an online sale). */
  closedAt: string | null
  /** False while the house still shows the sale as running. */
  finished: boolean
  totalLots: number
  /** Free text appended to the ingester's `kept` log line (Artcurial: the sale's specialties). */
  label?: string
}

export interface SaleFilter {
  saleRef?: string
  /**
   * Sales whose listing entry says they were last modified before this date cannot have
   * closed after it; an adapter that can tell (Ader's sitemap `<lastmod>`) skips them
   * without fetching their page. Others may ignore it.
   */
  modifiedSince?: Date
}

/** Everything house-specific the AuctionIngester needs: which sales to take, their lots, and how to read a lot page. */
export interface HouseAdapter {
  readonly house: AuctionHouse
  /**
   * The wanted sales of a year, already filtered by the house's sale rules, yielded lazily:
   * each sale's own page is fetched only when the next sale is asked for, so a caller that
   * stops iterating (time budget) stops fetching. A sale whose ref differs from `filter.saleRef`
   * is skipped before any fetch; a sale page that fails is logged and skipped.
   */
  listSales(year: number, filter: SaleFilter): AsyncIterable<HouseSale>
  /** Lot page URLs of a sale yielded by the current `listSales` iteration. */
  listLotUrls(sale: HouseSale): Promise<string[]>
  lotRefFromUrl(url: string): string
  /**
   * Null when the page parses but the lot was not sold; throws on fetch/parse failure,
   * and when `sale` was not yielded by `listSales` (the adapter keeps what it fetched for it).
   */
  fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null>
}
