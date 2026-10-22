export type JudgeStep = 'comp' | 'reference' | 'ranking'
export type CompProvider = 'claude' | 'gemini' | 'both'

export interface EvalClaudeJudgesArgs {
  step: JudgeStep
  /** Cases replayed: stored comp checks, reference matches (highest similarity first) or voted listings. */
  limit: number
  concurrency: number
  /** comp step: which verifiers replay the check; "both" also reports their consensus. */
  provider: CompProvider
  /** comp step: ad photos shown to the verifiers, cover first. */
  photos: number
  /** comp step: optional JSON file receiving every per-comparable verdict. */
  out: string | undefined
  /** comp step: dealer-page photos fetched per comparable; 0 keeps the Lens thumbnail only. */
  compPhotos: number
  /** comp step: Claude model to replay with, e.g. to weigh Sonnet against Opus. */
  claudeModel: string | undefined
  /** comp step: only replay these listings (comma-separated ids), e.g. the human-voted ones. */
  listingIds: string[] | undefined
}

const STEPS: JudgeStep[] = ['comp', 'reference', 'ranking']

export function parseEvalClaudeJudgesArgs(args: string[]): EvalClaudeJudgesArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const step = get('--step') as JudgeStep | undefined
  if (!step || !STEPS.includes(step)) throw new Error(`--step must be one of ${STEPS.join(', ')}`)
  return {
    step,
    limit: Number(get('--limit') ?? (step === 'ranking' ? 200 : 50)),
    concurrency: Number(get('--concurrency') ?? 3),
    provider: (get('--provider') as CompProvider | undefined) ?? 'claude',
    photos: Number(get('--photos') ?? 4),
    out: get('--out'),
    compPhotos: Number(get('--comp-photos') ?? 2),
    claudeModel: get('--claude-model'),
    listingIds: get('--listings')?.split(',').filter(Boolean),
  }
}
