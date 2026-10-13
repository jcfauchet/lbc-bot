import { describe, expect, it } from 'vitest'
import { parseEvalCompVerifyArgs } from './eval-comp-verify-args'

describe('parseEvalCompVerifyArgs', () => {
  it('defaults to 15 ads per vote, three at a time', () => {
    expect(parseEvalCompVerifyArgs([])).toEqual({ perVote: 15, concurrency: 3 })
  })
  it('reads the flags', () => {
    expect(parseEvalCompVerifyArgs(['--per-vote', '5', '--concurrency', '1'])).toEqual({ perVote: 5, concurrency: 1 })
  })
})
