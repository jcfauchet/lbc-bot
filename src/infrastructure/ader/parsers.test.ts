import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADER_CONFIG, isWantedAderSale } from './house-config'
import { parseLotPage } from './parse-lot-page'
import { parseLotPaths, parseSalePage } from './parse-sale-page'
import { parseSalesSitemap } from './parse-sales-sitemap'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

describe('parseSalesSitemap', () => {
  it('lists the sale ids and page URLs of the 2025 sitemap in order', () => {
    const sales = parseSalesSitemap(fixture('sales-2025.xml'))
    expect(sales).toHaveLength(20)
    expect(sales[0]).toEqual({
      id: '155653',
      url: 'https://ader-paris.fr/v/155653-judaica-hebraica-collection-elie-szapiro-livres-et-tableaux',
      lastmod: '2025-02-27T17:58:57Z',
    })
    expect(sales.map((s) => s.id)).toContain('161958')
    expect(new Set(sales.map((s) => s.id)).size).toBe(20)
  })

  it('ignores the alternate-language links and non-sale URLs', () => {
    const xml = `<urlset><url><loc>https://ader-paris.fr/v/1-a</loc>
      <xhtml:link rel="alternate" hreflang="en" href="https://ader-paris.fr/en/v/1-a"/></url>
      <url><loc>https://ader-paris.fr/l/2-b</loc></url><url><loc>https://ader-paris.fr/v/1-a</loc></url></urlset>`
    expect(parseSalesSitemap(xml)).toEqual([{ id: '1', url: 'https://ader-paris.fr/v/1-a', lastmod: null }])
  })
})

describe('parseSalePage', () => {
  const sale = parseSalePage(fixture('sale-182231-p1.html'))!

  it('reads the id, title, date and lot count of the sale', () => {
    expect(sale.id).toBe('182231')
    expect(sale.title).toBe('Côté XXᵉ - Vente à 11h00 et à 14h00')
    expect(sale.date).toBe('2026-10-23')
    expect(sale.totalLots).toBe(360)
  })

  it('lists the 50 lot paths of the first page', () => {
    expect(sale.lotPaths).toHaveLength(50)
    expect(new Set(sale.lotPaths).size).toBe(50)
    for (const path of sale.lotPaths) expect(path).toMatch(/^\/l\/\d+(-[^?#"]*)?$/)
    expect(sale.lotPaths).toContain('/l/35353927-etablissements-galle-1904-1936-libellule-en-vol-au-dessus')
  })

  it('returns null for a page that is not a sale page', () => {
    expect(parseSalePage('<html><body>Not found</body></html>')).toBeNull()
  })

  it('reads lot paths once each, without query or fragment', () => {
    const html = '<a href="/l/1-x">a</a><a href="/l/1-x?y=1#z">b</a><a href="/l/2-">c</a><a href="/l/4">e</a><a href="/v/3-x">d</a>'
    expect(parseLotPaths(html)).toEqual(['/l/1-x', '/l/2-', '/l/4'])
  })
})

describe('parseLotPage', () => {
  const lot = parseLotPage(fixture('lot-35353927.html'))!

  it('reads ids, number, title, estimate, result and fee rate', () => {
    expect(lot).toMatchObject({
      lotId: '35353927',
      saleId: '182231',
      lotNumber: '2',
      estimateLowEur: 600,
      estimateHighEur: 800,
      resultEur: 1450,
      premiumRate: 0.32,
    })
    expect(lot.title).toBe(
      'ÉTABLISSEMENTS GALLÉ (1904-1936) Libellule en vol au-dessus d’un marais fleuri de nénuphars, calthas et sagittaires',
    )
    expect(lot.description).toMatch(/^ÉTABLISSEMENTS GALLÉ \(1904-1936\) Libellule .* H\.17,5cm$/)
  })

  it('keeps the photos of its own sale', () => {
    expect(lot.photoHostId).toBe('97')
    expect(lot.photoHashes).toEqual(['7023ba01c810aba6b0e6593d503e2710'])
  })

  it('reads an unsold lot ("Non communiqué") with no result', () => {
    const unsold = parseLotPage(fixture('lot-35353926.html'))!
    expect(unsold.lotId).toBe('35353926')
    expect(unsold.resultEur).toBeNull()
    expect(unsold.estimateLowEur).toBe(400)
  })

  it('falls back to the house rate when no "Frais de vente" is printed', () => {
    const html = fixture('lot-35353927.html').replace(/Frais de vente/, 'Autre')
    expect(parseLotPage(html)!.premiumRate).toBeNull()
  })

  it('returns null for a page without a lot id or a sale link', () => {
    expect(parseLotPage('<html></html>')).toBeNull()
    expect(parseLotPage(fixture('lot-35353927.html').replace(/href="\/v\/\d+/g, 'href="/x'))).toBeNull()
  })
})

describe('Ader keep rule', () => {
  it('keeps decorative arts and design sales, drops the others', () => {
    for (const title of [
      'Côté XXᵉ - Vente à 11h00 et à 14h00',
      'Collection Art 1900 Grange Bat - XXe siècle',
      'Arts décoratifs et sculptures du XXe siècle',
      'Tableaux anciens & Arts décoratifs du XVIe au XIXe siècle',
      "Art graphique, bijoux, objets d'art et décoration, mobilier",
    ]) {
      expect(isWantedAderSale({ title, totalLots: 100 }), title).toBe(true)
    }
    for (const title of ['Vins, Champagnes & Spiritueux', 'Bijoux', 'Numismatique et or', 'Photographies', 'Orfèvrerie']) {
      expect(isWantedAderSale({ title, totalLots: 100 }), title).toBe(false)
    }
  })

  it('drops a wanted sale under 5 lots', () => {
    expect(isWantedAderSale({ title: 'Livres Online : Beaux-Arts, Photographie, Design, Bibliophilie...', totalLots: 282 })).toBe(false)
    expect(isWantedAderSale({ title: 'Côté XXᵉ', totalLots: 4 })).toBe(false)
    expect(isWantedAderSale({ title: 'Côté XXᵉ', totalLots: 5 })).toBe(true)
  })

  it('configures the fee-inclusive defaults', () => {
    expect(ADER_CONFIG).toMatchObject({ house: 'ADER', baseUrl: 'https://ader-paris.fr', defaultPremiumRate: 0.32 })
  })
})
