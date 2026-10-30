import type { IngestOptions } from '@/infrastructure/artcurial/ArtcurialIngester'

export function parseArtcurialIngestArgs(args: string[]): IngestOptions {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const year = Number(get('--year'))
  if (!Number.isInteger(year)) throw new Error('--year <YYYY> is required')
  const limit = get('--limit')
  return {
    year,
    saleRef: get('--sale'),
    limit: limit === undefined ? undefined : Number(limit),
    dryRun: args.includes('--dry-run'),
    concurrency: Number(get('--concurrency') ?? 3),
  }
}
