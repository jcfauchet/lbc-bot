export interface EvalAuctionReferencesArgs {
  /** Listings created in the last N days are replayed. */
  days: number
  /** Gemini verifications run on the first N gated pairs (0 = none). */
  verify: number
  /** Similarity thresholds compared side by side. */
  thresholds: number[]
}

export function parseEvalAuctionReferencesArgs(args: string[]): EvalAuctionReferencesArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    days: Number(get('--days') ?? 14),
    verify: Number(get('--verify') ?? 0),
    thresholds: (get('--thresholds') ?? '0.75,0.78,0.8').split(',').map(Number),
  }
}
