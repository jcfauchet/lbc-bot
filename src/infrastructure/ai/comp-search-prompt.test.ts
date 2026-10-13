import { describe, expect, it } from 'vitest'
import { buildCompSearchPrompt, parseCompSearchResult } from './comp-search-prompt'

describe('buildCompSearchPrompt', () => {
  it('names the piece from the ad and asks for priced comparables as strict JSON', () => {
    const prompt = buildCompSearchPrompt({ title: 'Table basse Willy Rizzo', description: 'Alveo, travertin', priceEur: 350 })
    expect(prompt).toContain('Table basse Willy Rizzo')
    expect(prompt).toContain('Alveo, travertin')
    expect(prompt).toContain('350')
    expect(prompt).toMatch(/JSON/)
  })

  it('works without a description', () => {
    expect(buildCompSearchPrompt({ title: 'Lampe', priceEur: 60 })).toContain('Lampe')
  })
})

describe('parseCompSearchResult', () => {
  it('maps comparables to matches, flagging value and mass-market domains', () => {
    const raw = `Here you go:\n{"comps": [
      {"title": "Willy Rizzo Alveo", "link": "https://www.selency.fr/x", "priceEur": 1200, "status": "listed"},
      {"title": "Table basse", "link": "https://www.amazon.fr/y", "priceEur": 89, "status": "listed"},
      {"title": "No price", "link": "https://www.pamono.fr/z"}
    ]}`
    const matches = parseCompSearchResult(raw)
    expect(matches).toHaveLength(3)
    expect(matches[0]).toMatchObject({ title: 'Willy Rizzo Alveo', source: 'selency.fr', isValueDomain: true, isMassMarket: false, price: { value: 1200, currency: 'EUR' } })
    expect(matches[1]).toMatchObject({ isValueDomain: false, isMassMarket: true })
    expect(matches[2].price).toBeUndefined()
  })

  it('drops entries without a usable link and ignores a non-numeric price', () => {
    const matches = parseCompSearchResult('{"comps":[{"title":"x"},{"title":"y","link":"https://1stdibs.com/a","priceEur":"n/a"}]}')
    expect(matches).toHaveLength(1)
    expect(matches[0].price).toBeUndefined()
  })

  it('returns no matches on garbage', () => {
    expect(parseCompSearchResult('sorry, nothing')).toEqual([])
    expect(parseCompSearchResult('{"comps": "nope"}')).toEqual([])
  })
})
