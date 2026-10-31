import { describe, expect, it } from 'vitest'
import { parseEvalAuctionReferencesArgs } from './eval-auction-references-args'

describe('parseEvalAuctionReferencesArgs', () => {
  it('defaults to 14 days, no verification and three thresholds', () => {
    expect(parseEvalAuctionReferencesArgs([])).toEqual({ days: 14, verify: 0, thresholds: [0.75, 0.78, 0.8], house: 'all' })
  })
  it('reads the flags', () => {
    expect(parseEvalAuctionReferencesArgs(['--days', '7', '--verify', '20', '--thresholds', '0.76,0.8']))
      .toEqual({ days: 7, verify: 20, thresholds: [0.76, 0.8], house: 'all' })
  })
  it('accepts --verify 0', () => {
    expect(parseEvalAuctionReferencesArgs(['--verify', '0']).verify).toBe(0)
  })
  it('parses --house', () => {
    expect(parseEvalAuctionReferencesArgs(['--house', 'rossini']).house).toBe('ROSSINI')
    expect(parseEvalAuctionReferencesArgs(['--house', 'artcurial']).house).toBe('ARTCURIAL')
    expect(parseEvalAuctionReferencesArgs(['--house', 'all']).house).toBe('all')
  })
  it.each([
    ['osenat', 'OSENAT'],
    ['pba', 'PBA'],
    ['gros-delettrez', 'GROS_DELETTREZ'],
  ])('parses --house %s', (slug, house) => {
    expect(parseEvalAuctionReferencesArgs(['--house', slug]).house).toBe(house)
  })
  it.each([
    [['--house', 'foo']],
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
