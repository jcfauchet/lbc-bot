export interface EvalArgs {
  limit: number
  withGuidance: boolean
  concurrency: number
  /** Gemini model to score with; unset means the production triage service. */
  model: string | undefined
  /** Thinking budget to pin on that model; unset leaves the model's default. */
  thinkingBudget: number | undefined
  /** Claude effort level; unset leaves the Claude triage default. */
  effort: 'low' | 'medium' | 'high' | undefined
}

export function parseEvalArgs(args: string[]): EvalArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const thinking = get('--thinking-budget')
  return {
    limit: Number(get('--limit') ?? 200),
    withGuidance: args.includes('--with-guidance'),
    concurrency: Number(get('--concurrency') ?? 3),
    model: get('--model'),
    thinkingBudget: thinking === undefined ? undefined : Number(thinking),
    effort: get('--effort') as EvalArgs['effort'],
  }
}
