import type { AuctionHouse } from '@/domain/auction-houses'

export interface EvalAuctionReferencesArgs {
  /** Listings created in the last N days are replayed. */
  days: number
  /** Gemini verifications run on the first N gated pairs (0 = none). */
  verify: number
  /** Similarity thresholds compared side by side. */
  thresholds: number[]
  /** Only auction candidates of this house are counted ('all' keeps every house). */
  house: AuctionHouse | 'all'
}

const HOUSES: Record<string, AuctionHouse | 'all'> = { artcurial: 'ARTCURIAL', rossini: 'ROSSINI', all: 'all' }

export function parseEvalAuctionReferencesArgs(args: string[]): EvalAuctionReferencesArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    return value
  }
  const integer = (flag: string, raw: string, min: number): number => {
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isInteger(value) || value < min) throw new Error(`${flag} must be an integer >= ${min}, got "${raw}"`)
    return value
  }
  const threshold = (raw: string): number => {
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`--thresholds entries must be numbers in (0, 1], got "${raw}"`)
    }
    return value
  }
  const days = get('--days')
  const verify = get('--verify')
  const rawHouse = get('--house') ?? 'all'
  const house = Object.hasOwn(HOUSES, rawHouse) ? HOUSES[rawHouse] : undefined
  if (!house) throw new Error(`--house must be artcurial, rossini or all, got "${rawHouse}"`)
  return {
    days: days === undefined ? 14 : integer('--days', days, 1),
    verify: verify === undefined ? 0 : integer('--verify', verify, 0),
    thresholds: (get('--thresholds') ?? '0.75,0.78,0.8').split(',').map(threshold),
    house,
  }
}
