export interface EvalCompsArgs {
  limit: number
  concurrency: number
  model: string
}

export function parseEvalCompsArgs(args: string[]): EvalCompsArgs {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    limit: Number(get('--limit') ?? 300),
    concurrency: Number(get('--concurrency') ?? 3),
    model: get('--model') ?? 'gemini-3.6-flash',
  }
}
