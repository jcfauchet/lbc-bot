import { describe, it, expect } from 'vitest'
import { TRIAGE_PROMPT, buildTriagePrompt, parseTriageScore, renderListingContext } from './triage-prompt'

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

  it('scores hidden-margin potential against the asking price, not visual appeal alone', () => {
    const lower = TRIAGE_PROMPT.toLowerCase()
    expect(lower).toContain('hidden-margin')
    expect(lower).toContain('asking price')
    // A beautiful piece at a fair price must not score high.
    expect(lower).toContain('no hidden margin')
  })

  it('tells the model to read the seller description', () => {
    expect(TRIAGE_PROMPT.toLowerCase()).toContain('description')
  })
})

describe('renderListingContext', () => {
  it('renders title and asking price for the model', () => {
    const out = renderListingContext({ title: 'Lampe champignon', priceEur: 45 })
    expect(out).toContain('Lampe champignon')
    expect(out).toContain('45€')
  })

  it('includes the seller description when provided', () => {
    const out = renderListingContext({
      title: 'Fauteuil', priceEur: 170,
      description: 'Chaise qui ressemble à Michel Boyer, très bon état',
    })
    expect(out).toContain('ressemble à Michel Boyer')
    expect(out.toLowerCase()).toContain('description')
  })

  it('omits the description line when the description is absent or blank', () => {
    const none = renderListingContext({ title: 'Table', priceEur: 60 })
    const blank = renderListingContext({ title: 'Table', priceEur: 60, description: '   ' })
    expect(none.toLowerCase()).not.toContain('description')
    expect(blank.toLowerCase()).not.toContain('description')
  })

  it('truncates a very long description to bound token cost', () => {
    const out = renderListingContext({ title: 'Buffet', priceEur: 200, description: 'x'.repeat(5000) })
    expect(out.length).toBeLessThan(1000)
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
