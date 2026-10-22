import { describe, expect, it } from 'vitest'
import { parseEvalClaudeJudgesArgs } from './eval-claude-judges-args'

describe('parseEvalClaudeJudgesArgs', () => {
  it('defaults the limit per step', () => {
    expect(parseEvalClaudeJudgesArgs(['--step', 'comp'])).toEqual({
      step: 'comp', limit: 50, concurrency: 3, provider: 'claude', photos: 4, out: undefined,
      compPhotos: 2, claudeModel: undefined, listingIds: undefined,
    })
    expect(parseEvalClaudeJudgesArgs(['--step', 'ranking']).limit).toBe(200)
  })

  it('reads explicit flags', () => {
    expect(parseEvalClaudeJudgesArgs(['--step', 'reference', '--limit', '10', '--concurrency', '1']))
      .toMatchObject({ step: 'reference', limit: 10, concurrency: 1 })
    expect(parseEvalClaudeJudgesArgs(['--step', 'comp', '--provider', 'both', '--photos', '1', '--out', 'v.json']))
      .toMatchObject({ provider: 'both', photos: 1, out: 'v.json' })
    expect(parseEvalClaudeJudgesArgs(['--step', 'comp', '--comp-photos', '0', '--claude-model', 'claude-sonnet-5-5', '--listings', 'a,b']))
      .toMatchObject({ compPhotos: 0, claudeModel: 'claude-sonnet-5-5', listingIds: ['a', 'b'] })
  })

  it('rejects a missing or unknown step, since each one spends Claude credit on different data', () => {
    expect(() => parseEvalClaudeJudgesArgs([])).toThrow(/--step/)
    expect(() => parseEvalClaudeJudgesArgs(['--step', 'triage'])).toThrow(/--step/)
  })
})
