import { describe, expect, it } from 'vitest'
import { parseEvalAppraisalAgentArgs } from './eval-appraisal-agent-args'

describe('parseEvalAppraisalAgentArgs', () => {
  it('defaults to 10 ads per vote on Sonnet, medium effort, capped at 10 $', () => {
    expect(parseEvalAppraisalAgentArgs([])).toEqual({
      perVote: 10, concurrency: 2, model: 'claude-sonnet-5-5', effort: 'medium', doubleCheck: false, maxUsd: 10, listings: [], out: undefined, lens: 'apify', lensCache: undefined,
    })
  })

  it('reads the flags', () => {
    expect(parseEvalAppraisalAgentArgs([
      '--per-vote', '3', '--concurrency', '1', '--model', 'claude-opus-5-5', '--effort', 'high',
      '--double-check', '--max-usd', '4', '--listings', 'a,b', '--out', 'run.jsonl', '--lens', 'none', '--lens-cache', 'lens.json',
    ])).toEqual({
      perVote: 3, concurrency: 1, model: 'claude-opus-5-5', effort: 'high', doubleCheck: true, maxUsd: 4, listings: ['a', 'b'], out: 'run.jsonl', lens: 'none', lensCache: 'lens.json',
    })
  })

  it('rejects an unknown effort or Lens source', () => {
    expect(() => parseEvalAppraisalAgentArgs(['--effort', 'max'])).toThrow('--effort')
    expect(() => parseEvalAppraisalAgentArgs(['--lens', 'serpapi'])).toThrow('--lens')
  })
})
