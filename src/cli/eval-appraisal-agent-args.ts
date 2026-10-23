export interface EvalAppraisalAgentArgs {
  /** Voted analyses taken per vote value (👍 and 👎), most recent first. */
  perVote: number
  concurrency: number
  model: string
  effort: 'low' | 'medium' | 'high'
  /** Re-check the agent's comparables with the production Opus + Sonnet consensus. */
  doubleCheck: boolean
  /** No new appraisal starts once the run has spent this much. */
  maxUsd: number
  /** Only these listing ids, when given. */
  listings: string[]
  /** JSONL file receiving one full appraisal per line. */
  out: string | undefined
  /** Where the agent's reverse-image leads come from; none tests web search alone. */
  lens: 'apify' | 'none'
  /** JSON file of Lens results by listing id, so a re-run never pays for a search twice. */
  lensCache: string | undefined
}

const EFFORTS = ['low', 'medium', 'high'] as const
const LENS = ['apify', 'none'] as const

export function parseEvalAppraisalAgentArgs(args: string[]): EvalAppraisalAgentArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const effort = get('--effort') ?? 'medium'
  if (!EFFORTS.includes(effort as (typeof EFFORTS)[number])) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}`)
  const lens = get('--lens') ?? 'apify'
  if (!LENS.includes(lens as (typeof LENS)[number])) throw new Error(`--lens must be one of ${LENS.join(', ')}`)
  return {
    perVote: Number(get('--per-vote') ?? 10),
    concurrency: Number(get('--concurrency') ?? 2),
    model: get('--model') ?? 'claude-sonnet-5-5',
    effort: effort as EvalAppraisalAgentArgs['effort'],
    doubleCheck: args.includes('--double-check'),
    maxUsd: Number(get('--max-usd') ?? 10),
    listings: get('--listings')?.split(',').filter(Boolean) ?? [],
    out: get('--out'),
    lens: lens as EvalAppraisalAgentArgs['lens'],
    lensCache: get('--lens-cache'),
  }
}
