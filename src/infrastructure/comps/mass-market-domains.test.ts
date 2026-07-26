import { describe, it, expect } from 'vitest'
import { isMassMarketDomain } from './mass-market-domains'

describe('isMassMarketDomain', () => {
  it('flags mass-produced retail / marketplace domains', () => {
    expect(isMassMarketDomain('https://www.cdiscount.com/maison/table-basse')).toBe(true)
    expect(isMassMarketDomain('Amazon.fr')).toBe(true)
    expect(isMassMarketDomain('https://fr.aliexpress.com/item/123.html')).toBe(true)
    expect(isMassMarketDomain('maisonsdumonde')).toBe(true)
  })

  it('does not flag value/auction domains nor ambiguous second-hand marketplaces', () => {
    expect(isMassMarketDomain('https://www.selency.fr/x')).toBe(false)
    expect(isMassMarketDomain('1stdibs.com')).toBe(false)
    expect(isMassMarketDomain('https://www.ebay.fr/itm/123')).toBe(false)
    expect(isMassMarketDomain('etsy.com/listing/1')).toBe(false)
    expect(isMassMarketDomain('vinted.fr')).toBe(false)
  })
})
