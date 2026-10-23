import { describe, expect, it } from 'vitest'
import type { ProductPage } from '@/infrastructure/comps/product-page-photos'
import { acceptedComps, appraisalLeads, buildAppraisalBrief, describeInspectedPage, describeLead, normalizeUrl } from './appraisal-agent-prompt'

const page = (overrides: Partial<ProductPage> = {}): ProductPage => ({
  title: 'Brass table', price: { value: 900, currency: 'EUR' }, photos: ['https://cdn/1.jpg'], ...overrides,
})

describe('acceptedComps', () => {
  it('keeps only inspected pages with a published price and a photo, each once', () => {
    const inspected = new Map<string, ProductPage | null>([
      ['https://www.pamono.com/table-a', page()],
      ['https://www.pamono.com/no-price', page({ price: null })],
      ['https://www.pamono.com/no-photo', page({ photos: [] })],
      ['https://www.pamono.com/blocked', null],
    ])
    const comps = acceptedComps([
      'https://www.pamono.com/table-a/', 'https://www.pamono.com/table-a#gallery',
      'https://www.pamono.com/no-price', 'https://www.pamono.com/no-photo', 'https://www.pamono.com/blocked',
      'https://www.1stdibs.com/never-opened',
    ], inspected)
    expect(comps).toEqual([{
      title: 'Brass table', source: 'pamono.com', link: 'https://www.pamono.com/table-a',
      price: { value: 900, currency: 'EUR' }, photoUrls: ['https://cdn/1.jpg'], isValueDomain: true, isMassMarket: false,
    }])
  })

  it('drops a price in a currency scoring cannot convert', () => {
    const inspected = new Map([['https://shop.example/x', page({ price: { value: 9000, currency: 'JPY' } })]])
    expect(acceptedComps(['https://shop.example/x'], inspected)).toEqual([])
  })

  it('flags mass-market retail so scoring ignores it', () => {
    const [comp] = acceptedComps(['https://www.amazon.fr/x'], new Map([['https://www.amazon.fr/x', page()]]))
    expect(comp).toMatchObject({ isValueDomain: false, isMassMarket: true })
  })
})

describe('appraisalLeads', () => {
  const lead = (link: string) => ({ title: link, link, source: 's', isValueDomain: true })
  it('drops Leboncoin ads and repeated pages, keeps Lens order, caps the count', () => {
    const leads = appraisalLeads([lead('https://www.leboncoin.fr/ad/1'), lead('https://a.example/1'), lead('https://a.example/1/'), lead('https://b.example/2')])
    expect(leads.map((l) => l.link)).toEqual(['https://a.example/1', 'https://b.example/2'])
    expect(appraisalLeads(Array.from({ length: 40 }, (_, i) => lead(`https://a.example/${i}`)))).toHaveLength(20)
    expect(appraisalLeads(undefined)).toEqual([])
  })

  it('labels mass-market retail in the lead line', () => {
    expect(describeLead({ ...lead('https://www.amazon.fr/x'), source: 'Amazon', isMassMarket: true }, 3))
      .toBe('Lead 3: [Amazon] https://www.amazon.fr/x (mass-market retail) — https://www.amazon.fr/x')
  })
})

describe('normalizeUrl', () => {
  it('drops the fragment and a trailing slash, and tolerates garbage', () => {
    expect(normalizeUrl('https://a.example/p/1/#top')).toBe('https://a.example/p/1')
    expect(normalizeUrl(' not a url ')).toBe('not a url')
  })
})

describe('buildAppraisalBrief', () => {
  it('states title and price, and truncates a long description', () => {
    const brief = buildAppraisalBrief({ title: 'Table', priceEur: 90, description: 'x'.repeat(2000), imageUrls: [] })
    expect(brief).toContain('"Table"')
    expect(brief).toContain('90 €')
    expect(brief.length).toBeLessThan(800)
  })
})

describe('describeInspectedPage', () => {
  it('tells the agent when a page has no usable price', () => {
    expect(describeInspectedPage(page({ price: null }), 1)).toContain('cannot be used as a priced comparable')
    expect(describeInspectedPage(null, 0)).toContain('Could not read this page')
  })
})
