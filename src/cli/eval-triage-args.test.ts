import { describe, expect, it } from 'vitest'
import { parseEvalArgs } from './eval-triage-args'

describe('parseEvalArgs', () => {
  it('defaults to the production triage service', () => {
    expect(parseEvalArgs([])).toEqual({ limit: 200, withGuidance: false, concurrency: 3, model: undefined, thinkingBudget: undefined })
  })

  it('lets a run pin a Gemini model and a thinking budget to compare against production', () => {
    expect(parseEvalArgs(['--model', 'gemini-2.5-flash', '--thinking-budget', '0'])).toMatchObject({
      model: 'gemini-2.5-flash', thinkingBudget: 0,
    })
  })

  it('keeps the existing flags', () => {
    expect(parseEvalArgs(['--limit', '50', '--with-guidance', '--concurrency', '2'])).toMatchObject({
      limit: 50, withGuidance: true, concurrency: 2,
    })
  })
})
