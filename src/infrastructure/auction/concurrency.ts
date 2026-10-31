import type { AuctionHouse } from '@/domain/auction-houses'
import { DROUOT_HOUSES } from '@/infrastructure/drouot/house-configs'

const DEFAULT_CONCURRENCY = 3

/** Lot pages fetched in parallel for a house: a Drouot-platform house sets its own (PBA answers 429 above 1). */
export function concurrencyFor(house: AuctionHouse): number {
  return Object.values(DROUOT_HOUSES).find((config) => config.house === house)?.concurrency ?? DEFAULT_CONCURRENCY
}
