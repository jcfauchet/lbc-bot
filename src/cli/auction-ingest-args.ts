import { HOUSE_SLUGS, type AuctionHouse } from '@/domain/auction-houses'
import { concurrencyFor } from '@/infrastructure/auction/concurrency'
import type { IngestOptions } from '@/infrastructure/auction/AuctionIngester'

export interface AuctionIngestArgs {
  /** Which house's ingester runs; picked from `container.auctionIngesters`. */
  house: AuctionHouse
  options: IngestOptions
}

export function parseAuctionIngestArgs(args: string[]): AuctionIngestArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const year = Number(get('--year'))
  if (!Number.isInteger(year)) throw new Error('--year <YYYY> is required')
  const positiveInt = (flag: string, raw: string): number => {
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer, got "${raw}"`)
    return value
  }
  const rawHouse = get('--house') ?? 'artcurial'
  const house = Object.hasOwn(HOUSE_SLUGS, rawHouse) ? HOUSE_SLUGS[rawHouse] : undefined
  if (!house) throw new Error(`--house must be one of ${Object.keys(HOUSE_SLUGS).join(', ')}, got "${rawHouse}"`)
  const limit = get('--limit')
  const concurrency = get('--concurrency')
  return {
    house,
    options: {
      year,
      saleRef: get('--sale'),
      limit: limit === undefined ? undefined : positiveInt('--limit', limit),
      dryRun: args.includes('--dry-run'),
      concurrency: concurrency === undefined ? concurrencyFor(house) : positiveInt('--concurrency', concurrency),
    },
  }
}
