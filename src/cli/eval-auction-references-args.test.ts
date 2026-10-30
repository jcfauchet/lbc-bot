import { describe, expect, it } from 'vitest'
import { parseEvalAuctionReferencesArgs } from './eval-auction-references-args'

describe('parseEvalAuctionReferencesArgs', () => {
  it('defaults to 14 days, no verification and three thresholds', () => {
    expect(parseEvalAuctionReferencesArgs([])).toEqual({ days: 14, verify: 0, thresholds: [0.75, 0.78, 0.8] })
  })
  it('reads the flags', () => {
    expect(parseEvalAuctionReferencesArgs(['--days', '7', '--verify', '20', '--thresholds', '0.76,0.8']))
      .toEqual({ days: 7, verify: 20, thresholds: [0.76, 0.8] })
  })
  it('accepts --verify 0', () => {
    expect(parseEvalAuctionReferencesArgs(['--verify', '0']).verify).toBe(0)
  })
  it.each([
    [['--days', 'abc']],
    [['--days', '0']],
    [['--verify', '-3']],
    [['--thresholds', '0.8,']],
    [['--thresholds', '1.5']],
    [['--thresholds', '0']],
    [['--days']],
  ])('rejects %j', (args) => {
    expect(() => parseEvalAuctionReferencesArgs(args)).toThrow()
  })
})
