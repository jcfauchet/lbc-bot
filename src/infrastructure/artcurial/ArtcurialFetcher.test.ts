import { describe, expect, it } from 'vitest'
import { timeoutMsFor } from './ArtcurialFetcher'

describe('timeoutMsFor', () => {
  it('gives a yearly sitemap a long timeout', () => {
    expect(timeoutMsFor('https://www.artcurial.com/sitemap/sales-2025-fr.xml')).toBe(90_000)
  })
  it('keeps the short timeout for sale and lot pages', () => {
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064')).toBe(15_000)
    expect(timeoutMsFor('https://www.artcurial.com/ventes/IT6064/lots/278-a')).toBe(15_000)
  })
})
