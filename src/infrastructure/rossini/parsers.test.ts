import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrenchDate } from './french-date'
import { isWantedSale } from './is-wanted-sale'
import { parseCataloguePage } from './parse-catalogue-page'
import { parseLotPage } from './parse-lot-page'
import { parseYearPage } from './parse-year-page'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const yearHtml = fixture('year-2025.html')
const cataloguePage1 = fixture('catalogue-186362-p1.html')
const cataloguePage2 = fixture('catalogue-186362-p2.html')
const lotHtml = fixture('lot-180689-34122319.html')

describe('rossini parsers', () => {
  it('parses the sales of a year page', () => {
    const sales = parseYearPage(yearHtml)
    expect(sales).toHaveLength(77)
    const sale = sales.find((s) => s.id === '174947')!
    expect(sale.title).toBe('Numismatique, Bijoux, Horlogerie et Luxe')
    expect(sale.date).toBe('2025-12-31')
    expect(sale.catalogueUrl).toBe('/catalogue/174947-numismatique-bijoux-horlogerie-et-luxe')
  })

  it('parses a catalogue page', () => {
    const page1 = parseCataloguePage(cataloguePage1)
    expect(page1.total).toBe(138)
    expect(page1.lotUrls).toHaveLength(50)
    for (const url of page1.lotUrls) expect(url).toMatch(/^\/lot\/186362\/\d+$/)
    const page2 = parseCataloguePage(cataloguePage2)
    expect(page2.lotUrls).toHaveLength(50)
    expect(page2.lotUrls.filter((u) => page1.lotUrls.includes(u))).toEqual([])
  })

  it('parses the lot page', () => {
    const lot = parseLotPage(lotHtml)!
    expect(lot).toMatchObject({
      saleId: '180689',
      lotId: '34122319',
      lotNumber: '72',
      estimateLowEur: 300000,
      estimateHighEur: 500000,
      resultEur: 555000,
    })
    expect(lot.title.startsWith('RODIN Auguste')).toBe(true)
    expect(lot.description).toContain('Le Baiser')
    expect(lot.description).not.toContain('<')
    expect(lot.photoHashes).toHaveLength(6)
    for (const hash of lot.photoHashes) expect(hash).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a null result when the lot has no Résultat line', () => {
    const html = lotHtml.replace(/Résultat\s*:\s*<nobr>[^<]*<\/nobr>/, '')
    expect(html).not.toBe(lotHtml)
    expect(parseLotPage(html)!.resultEur).toBeNull()
  })

  it('returns null when the page has no lot', () => {
    expect(parseLotPage('<html><body>Page introuvable</body></html>')).toBeNull()
  })

  it('parses French dates', () => {
    expect(parseFrenchDate('mercredi 31 décembre 2025 à 14h00')).toBe('2025-12-31')
    expect(parseFrenchDate('jeudi 1er février 2024 à  9h30')).toBe('2024-02-01')
    expect(parseFrenchDate('samedi 9 août 2025')).toBe('2025-08-09')
    expect(parseFrenchDate('prochainement')).toBeNull()
    expect(parseFrenchDate('')).toBeNull()
  })

  it('filters sales by title', () => {
    expect(isWantedSale({ title: "Mobilier & Objets d'art" })).toBe(true)
    expect(isWantedSale({ title: 'Intérieurs modernes & contemporains' })).toBe(true)
    expect(
      isWantedSale({ title: "Livres, Timbres, Mobilier, Objets d'Art & Arts de la Table" }),
    ).toBe(true)
    expect(isWantedSale({ title: 'Numismatique, Bijoux & Montres' })).toBe(false)
    expect(isWantedSale({ title: 'Affiches, Lithographies & Œuvres papier' })).toBe(false)
    expect(isWantedSale({ title: 'Art Moderne & Intérieurs contemporains' })).toBe(true)
    expect(isWantedSale({ title: 'Mobilier', totalLots: 3 })).toBe(false)
    expect(isWantedSale({ title: 'Mobilier', totalLots: 5 })).toBe(true)
  })
})
