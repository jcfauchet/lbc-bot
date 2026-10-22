import { describe, expect, it } from 'vitest'
import { parseEvalClaudeJudgesArgs } from './eval-claude-judges-args'

describe('parseEvalClaudeJudgesArgs', () => {
  it('defaults the limit per step', () => {
    expect(parseEvalClaudeJudgesArgs(['--step', 'comp'])).toEqual({ step: 'comp', limit: 50, concurrency: 3 })
    expect(parseEvalClaudeJudgesArgs(['--step', 'ranking']).limit).toBe(200)
  })

  it('reads explicit flags', () => {
    expect(parseEvalClaudeJudgesArgs(['--step', 'reference', '--limit', '10', '--concurrency', '1']))
      .toEqual({ step: 'reference', limit: 10, concurrency: 1 })
  })

  it('rejects a missing or unknown step, since each one spends Claude credit on different data', () => {
    expect(() => parseEvalClaudeJudgesArgs([])).toThrow(/--step/)
    expect(() => parseEvalClaudeJudgesArgs(['--step', 'triage'])).toThrow(/--step/)
  })
})
