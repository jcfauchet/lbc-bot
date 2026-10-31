import type { IngestOptions } from '@/infrastructure/auction/AuctionIngester'

export function parseArtcurialIngestArgs(args: string[]): IngestOptions {
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
  const limit = get('--limit')
  const concurrency = get('--concurrency')
  return {
    year,
    saleRef: get('--sale'),
    limit: limit === undefined ? undefined : positiveInt('--limit', limit),
    dryRun: args.includes('--dry-run'),
    concurrency: concurrency === undefined ? 3 : positiveInt('--concurrency', concurrency),
  }
}
