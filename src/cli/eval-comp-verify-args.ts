export interface EvalCompVerifyArgs {
  /** Voted analyses taken per vote value (👍 and 👎), most recent first. */
  perVote: number
  concurrency: number
}

export function parseEvalCompVerifyArgs(args: string[]): EvalCompVerifyArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    perVote: Number(get('--per-vote') ?? 15),
    concurrency: Number(get('--concurrency') ?? 3),
  }
}
