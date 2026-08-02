import { describe, it, expect } from 'vitest'
import { buildRankingPrompt, parseRanking, renderCandidateList, RANKING_PROMPT } from './ranking-prompt'
import type { RankingCandidate } from '@/domain/services/ISelectionRanker'

const candidates: RankingCandidate[] = [
  { listingId: 'a', imageUrl: 'https://img/a.jpg', title: 'Lampe laiton', priceEur: 80 },
  { listingId: 'b', imageUrl: 'https://img/b.jpg', title: 'Table travertin', priceEur: 250 },
  { listingId: 'c', imageUrl: 'https://img/c.jpg', title: 'Chaise teck', priceEur: 120 },
]

describe('parseRanking', () => {
  it('maps candidate numbers to listing ids, best first', () => {
    const raw = '{"picks":[{"candidate":2,"worthCredit":true,"reason":"travertin"},{"candidate":1,"worthCredit":false}]}'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'b', rank: 1, worthCredit: true, reason: 'travertin' },
      { listingId: 'a', rank: 2, worthCredit: false, reason: undefined },
    ])
  })

  it('returns null when the response cannot be parsed, so the caller can fall back', () => {
    expect(parseRanking('sorry, I cannot help with that', candidates)).toBeNull()
    expect(parseRanking('{"picks":[{"candidate":1,', candidates)).toBeNull()
  })

  it('distinguishes a deliberate abstention from a parse failure', () => {
    expect(parseRanking('{"picks":[]}', candidates)).toEqual([])
  })

  it('reads through markdown code fences', () => {
    const raw = '```json\n{"picks":[{"candidate":3,"worthCredit":true}]}\n```'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'c', rank: 1, worthCredit: true, reason: undefined },
    ])
  })

  it('drops out-of-range, non-integer and duplicated candidate numbers', () => {
    const raw = '{"picks":[{"candidate":9},{"candidate":0},{"candidate":1.5},{"candidate":1},{"candidate":1}]}'
    expect(parseRanking(raw, candidates)).toEqual([
      { listingId: 'a', rank: 1, worthCredit: true, reason: undefined },
    ])
  })

  it('treats a missing worthCredit as worth a credit', () => {
    expect(parseRanking('{"picks":[{"candidate":1}]}', candidates)?.[0].worthCredit).toBe(true)
  })
})

describe('renderCandidateList', () => {
  it('numbers candidates from 1 and includes the asking price', () => {
    const rendered = renderCandidateList(candidates)
    expect(rendered).toContain('Candidate 1: Lampe laiton')
    expect(rendered).toContain('Asking price: 80€')
    expect(rendered).toContain('Candidate 3: Chaise teck')
  })

  it('truncates a long seller description and omits a blank one', () => {
    const rendered = renderCandidateList([
      { ...candidates[0], description: 'x'.repeat(500) },
      { ...candidates[1], description: '   ' },
    ])
    expect(rendered).toContain(`Seller description: ${'x'.repeat(300)}\n`)
    expect(rendered).not.toContain('x'.repeat(301))
    expect(rendered.match(/Seller description/g)).toHaveLength(1)
  })
})

describe('buildRankingPrompt', () => {
  it('returns the bare prompt without guidance', () => {
    expect(buildRankingPrompt()).toBe(RANKING_PROMPT)
    expect(buildRankingPrompt('   ')).toBe(RANKING_PROMPT)
  })

  it('appends guidance, truncated to the cap', () => {
    const built = buildRankingPrompt('y'.repeat(2500))
    expect(built).toContain('y'.repeat(2000))
    expect(built).not.toContain('y'.repeat(2001))
  })
})
