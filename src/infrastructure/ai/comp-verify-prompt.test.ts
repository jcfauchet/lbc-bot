import { describe, expect, it } from 'vitest'
import { buildCompVerifyPrompt, parseCompVerdicts } from './comp-verify-prompt'

describe('buildCompVerifyPrompt', () => {
  it('tells the model which image is the ad and how many candidates follow', () => {
    const prompt = buildCompVerifyPrompt({ listingTitle: 'Table basse Alveo', compCount: 3 })
    expect(prompt).toContain('Table basse Alveo')
    expect(prompt).toContain('3')
    expect(prompt).toMatch(/JSON/)
  })
})

describe('parseCompVerdicts', () => {
  it('turns 1-based confirmed indices into one flag per candidate', () => {
    expect(parseCompVerdicts('{"confirmed": [1, 3]}', 4)).toEqual([true, false, true, false])
  })
  it('ignores indices out of range and non-numbers', () => {
    expect(parseCompVerdicts('{"confirmed": [0, 2, 9, "x"]}', 3)).toEqual([false, true, false])
  })
  it('confirms nothing on garbage, so a broken answer never inflates an estimate', () => {
    expect(parseCompVerdicts('no idea', 2)).toEqual([false, false])
    expect(parseCompVerdicts('{"confirmed": "all"}', 2)).toEqual([false, false])
  })
})
