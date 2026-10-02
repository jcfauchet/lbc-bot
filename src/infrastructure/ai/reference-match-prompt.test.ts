import { describe, it, expect } from 'vitest'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from './reference-match-prompt'

const FENCE = '`'.repeat(3)

describe('parseReferenceVerdict', () => {
  it('reads strict JSON', () => {
    expect(parseReferenceVerdict('{"same": true, "reason": "same brass frame and glass shelves"}'))
      .toEqual({ same: true, reason: 'same brass frame and glass shelves' })
  })
  it('reads JSON wrapped in a markdown fence', () => {
    expect(parseReferenceVerdict(`${FENCE}json\n{"same": false, "reason": "different legs"}\n${FENCE}`))
      .toEqual({ same: false, reason: 'different legs' })
  })
  it('treats prose, empty or malformed output as not the same', () => {
    expect(parseReferenceVerdict('I think it might be the same')).toEqual({ same: false, reason: null })
    expect(parseReferenceVerdict('')).toEqual({ same: false, reason: null })
    expect(parseReferenceVerdict('{"same": "yes"')).toEqual({ same: false, reason: null })
  })
  it('requires a real boolean true', () => {
    expect(parseReferenceVerdict('{"same": "true"}')).toEqual({ same: false, reason: null })
  })
})

describe('buildReferenceMatchPrompt', () => {
  it('names the reference, the note and the image order', () => {
    const prompt = buildReferenceMatchPrompt({
      listingTitle: 'Table roulante dorée', referenceName: 'Desserte Jansen', referenceNote: 'plateaux en verre',
      listingImageCount: 2, referenceImageCount: 3,
    })
    expect(prompt).toContain('Desserte Jansen')
    expect(prompt).toContain('plateaux en verre')
    expect(prompt).toContain('Table roulante dorée')
    expect(prompt).toContain('first 2 images')
    expect(prompt).toContain('next 3 images')
  })
})
