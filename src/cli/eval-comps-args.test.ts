import { describe, expect, it } from 'vitest'
import { parseEvalCompsArgs } from './eval-comps-args'

describe('parseEvalCompsArgs', () => {
  it('defaults to every voted analysis, three at a time, on gemini-3.6-flash', () => {
    expect(parseEvalCompsArgs([])).toEqual({ limit: 300, concurrency: 3, model: 'gemini-3.6-flash' })
  })
  it('reads the flags', () => {
    expect(parseEvalCompsArgs(['--limit', '20', '--concurrency', '1', '--model', 'gemini-3.8-flash']))
      .toEqual({ limit: 20, concurrency: 1, model: 'gemini-3.8-flash' })
  })
})
