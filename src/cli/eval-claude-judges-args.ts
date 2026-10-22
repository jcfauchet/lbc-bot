export type JudgeStep = 'comp' | 'reference' | 'ranking'

export interface EvalClaudeJudgesArgs {
  step: JudgeStep
  /** Cases replayed: stored comp checks, reference matches (highest similarity first) or voted listings. */
  limit: number
  concurrency: number
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
  }
}
