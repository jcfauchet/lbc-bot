import { describe, expect, it } from 'vitest'
import { parseAuctionIngestArgs } from './auction-ingest-args'

describe('parseAuctionIngestArgs', () => {
  it('parses every flag', () => {
    expect(parseAuctionIngestArgs(['--year', '2025', '--house', 'rossini', '--sale', 'IT6064', '--limit', '50', '--dry-run'])).toEqual({
      house: 'ROSSINI',
      options: { year: 2025, saleRef: 'IT6064', limit: 50, dryRun: true, concurrency: 3 },
    })
  })
  it('defaults to Artcurial and a real run with 3 workers', () => {
    expect(parseAuctionIngestArgs(['--year', '2024', '--concurrency', '5'])).toEqual({
      house: 'ARTCURIAL',
      options: { year: 2024, saleRef: undefined, limit: undefined, dryRun: false, concurrency: 5 },
    })
  })
  it('parses --house artcurial', () => {
    expect(parseAuctionIngestArgs(['--year', '2025', '--house', 'artcurial']).house).toBe('ARTCURIAL')
  })
  it('rejects an unknown --house', () => {
    expect(() => parseAuctionIngestArgs(['--year', '2025', '--house', 'foo'])).toThrow(/--house/)
  })
  it('parses --concurrency 4', () => {
    expect(parseAuctionIngestArgs(['--year', '2025', '--concurrency', '4']).options.concurrency).toBe(4)
  })
  it('rejects a non-numeric or non-positive --concurrency or --limit', () => {
    expect(() => parseAuctionIngestArgs(['--year', '2025', '--concurrency', 'abc'])).toThrow(/--concurrency/)
    expect(() => parseAuctionIngestArgs(['--year', '2025', '--limit', 'abc'])).toThrow(/--limit/)
    expect(() => parseAuctionIngestArgs(['--year', '2025', '--limit', '0'])).toThrow(/--limit/)
  })
  it('throws without --year', () => {
    expect(() => parseAuctionIngestArgs(['--dry-run'])).toThrow(/--year/)
  })
})
