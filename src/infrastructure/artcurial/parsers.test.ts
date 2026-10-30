import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLotPage, stripHtml } from './parse-lot-page'
import { parseSalePage } from './parse-sale-page'
import { parseSitemap } from './parse-sitemap'

const lotHtml = readFileSync(join(__dirname, '__fixtures__/lot-IT6064-278-a.html'), 'utf8')
const saleHtml = readFileSync(join(__dirname, '__fixtures__/sale-IT6064.html'), 'utf8')
const sitemap = readFileSync(join(__dirname, '__fixtures__/sitemap-2025-excerpt.xml'), 'utf8')

describe('artcurial parsers', () => {
  it('parses the lot page', () => {
    const lot = parseLotPage(lotHtml)!
    expect(lot).toMatchObject({
      saleRef: 'IT6064',
      lotRef: '278-a',
      status: 'SOLD',
      hammerEur: 11000,
      estimateLowEur: 8000,
      estimateHighEur: 12000,
      artist: 'Poul KJAERHOLM',
      artistYears: '1929-1980',
    })
    expect(lot.title).toBe('Suite de dix chaises mod. PK9 - 1960')
    expect(lot.description).toContain('Édition E. Kold Christensen')
    expect(lot.description).not.toContain('<p>')
    expect(lot.pictureUrls.length).toBeGreaterThan(0)
    expect(lot.pictureUrls[0]).toMatch(
      /^https:\/\/storage\.googleapis\.com\/art-fr-maya-prod-inventory\/.*PICTURE_CATALOG/,
    )
    expect(lot.soldAt).toMatch(/^2025-/)
  })
  it('leaves no HTML entity in the lot title and description', () => {
    const lot = parseLotPage(lotHtml)!
    for (const text of [lot.title, lot.description]) {
      expect(text).not.toContain('&#')
      expect(text).not.toContain('&amp;')
    }
  })
  it('strips tags and decodes entities', () => {
    expect(stripHtml('<p>L&#39;art &amp; la mani&egrave;re&nbsp;!</p>')).toBe("L'art & la manière !")
    expect(stripHtml('&quot;a&quot; &lt;b&gt; &#x41;&#66; &apos;c&apos;')).toBe('"a" <b> AB \'c\'')
    expect(stripHtml('&amp;#39;')).toBe('&#39;')
    expect(stripHtml('&#38;amp;')).toBe('&amp;')
  })
  it('decodes the common French named entities', () => {
    expect(stripHtml('&Eacute;b&eacute;niste &agrave; Gen&egrave;ve, fa&ccedil;ade &oelig;uvre &laquo;&nbsp;Plia&nbsp;&raquo;'))
      .toBe('Ébéniste à Genève, façade œuvre « Plia »')
    expect(stripHtml('l&rsquo;&ecirc;tre&hellip; 1960&ndash;1970 &mdash; 20&deg; 3 m&sup2; &frac12;'))
      .toBe('l’être… 1960–1970 — 20° 3 m² ½')
    expect(stripHtml('&unknown; &AMP;')).toBe('&unknown; &AMP;')
  })
  it('parses the sale page', () => {
    // The payload's totalLots is 303, while the sitemap lists 314 lot URLs for this sale
    expect(parseSalePage(saleHtml)).toMatchObject({ ref: 'IT6064', totalLots: 303 })
    expect(parseSalePage(saleHtml)!.specialties).toContain('DESIGN')
  })
  it('parses the sale status and the online sale end date', () => {
    expect(parseSalePage(saleHtml)).toMatchObject({
      status: 'FINISHED',
      beginDate: '2025-03-11T13:00:00Z',
      endDate: '2025-03-18T09:00:00Z',
    })
  })
  it('groups sitemap lot urls by sale', () => {
    const { lotUrlsBySale } = parseSitemap(sitemap)
    expect(lotUrlsBySale.get('IT6064')).toContain('https://www.artcurial.com/ventes/IT6064/lots/278-a')
    expect(new Set(lotUrlsBySale.get('IT6064')).size).toBe(lotUrlsBySale.get('IT6064')!.length)
  })
  it('returns null on a page without payload', () => {
    expect(parseLotPage('<html></html>')).toBeNull()
    expect(parseSalePage('<html></html>')).toBeNull()
  })
  it('does not invent a hammer price', () => {
    const html = lotHtml.replace('"adjudicationPrice"', '"adjudicationPriceX"')
    expect(parseLotPage(html)).toBeNull()
  })
})
