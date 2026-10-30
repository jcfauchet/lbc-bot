import { describe, expect, it } from 'vitest'
import { parseArtcurialIngestArgs } from './artcurial-ingest-args'

describe('parseArtcurialIngestArgs', () => {
  it('parses every flag', () => {
    expect(parseArtcurialIngestArgs(['--year', '2025', '--sale', 'IT6064', '--limit', '50', '--dry-run'])).toEqual({
      year: 2025, saleRef: 'IT6064', limit: 50, dryRun: true, concurrency: 3,
    })
  })
  it('defaults to a real run with 3 workers', () => {
    expect(parseArtcurialIngestArgs(['--year', '2024', '--concurrency', '5'])).toEqual({ year: 2024, saleRef: undefined, limit: undefined, dryRun: false, concurrency: 5 })
  })
  it('throws without --year', () => {
    expect(() => parseArtcurialIngestArgs(['--dry-run'])).toThrow(/--year/)
  })
})
