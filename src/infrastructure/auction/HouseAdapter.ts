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
}

/** Everything house-specific the AuctionIngester needs: which sales to take, their lots, and how to read a lot page. */
export interface HouseAdapter {
  readonly house: AuctionHouse
  /** The wanted sales of a year, already filtered by the house's sale rules. */
  listSales(year: number): Promise<HouseSale[]>
  listLotUrls(sale: HouseSale): Promise<string[]>
  lotRefFromUrl(url: string): string
  /** Null when the page parses but the lot was not sold; throws on fetch/parse failure. */
  fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null>
}
