import { describe, it, expect } from 'vitest'
import { TRIAGE_PROMPT, buildTriagePrompt, parseTriageScore } from './triage-prompt'

describe('parseTriageScore', () => {
  it('extracts a 0-10 integer from a JSON-ish reply', () => {
    expect(parseTriageScore('{"score": 8, "rationale": "brass lamp"}')).toEqual({ score: 8, rationale: 'brass lamp' })
  })
  it('clamps out-of-range and falls back to 0 on garbage', () => {
    expect(parseTriageScore('score: 99').score).toBe(10)
    expect(parseTriageScore('no number here').score).toBe(0)
  })
  it('prefers the score field/word over incidental numbers', () => {
    expect(parseTriageScore('This 19th century piece scores a 7').score).toBe(7)
    expect(parseTriageScore('{"score": 6, "rationale": "circa 1850 lamp"}').score).toBe(6)
  })
})

describe('TRIAGE_PROMPT', () => {
  it('instructs NOT to name a designer', () => {
    expect(TRIAGE_PROMPT.toLowerCase()).toContain('do not')
  })
})

describe('buildTriagePrompt', () => {
  it('returns the base prompt when no guidance', () => {
    expect(buildTriagePrompt()).toBe(TRIAGE_PROMPT)
    expect(buildTriagePrompt('')).toBe(TRIAGE_PROMPT)
    expect(buildTriagePrompt('   ')).toBe(TRIAGE_PROMPT)
  })

  it('appends guidance when present', () => {
    const out = buildTriagePrompt('- avoid flat-pack lookalikes')
    expect(out).toContain(TRIAGE_PROMPT)
    expect(out).toContain('avoid flat-pack lookalikes')
    expect(out.toLowerCase()).toContain('lessons learned')
  })

  it('caps guidance length', () => {
    const out = buildTriagePrompt('x'.repeat(5000))
    expect(out.length).toBeLessThan(TRIAGE_PROMPT.length + 2200)
  })
})
