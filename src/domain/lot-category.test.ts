import { describe, expect, it } from 'vitest'
import { categoryOf, categorySqlConditions } from './lot-category'

describe('categoryOf', () => {
  it.each([
    ['Suite de dix chaises mod. PK9 - 1960', 'FURNITURE'],
    ['Table basse, plateau en marbre', 'FURNITURE'],
    ['Paire d\'appliques "Au vase fleuri"', 'LIGHTING'],
    ['Miroir soleil en talosel', 'MIRRORS'],
    ['Vase "Clématites" - circa 1900', 'GLASS_CERAMICS'],
    ['Bronze animalier, épreuve à patine brune', 'SCULPTURE'],
    ['Ménagère en argent, 120 pièces', 'SILVER'],
    ['Edmond LACHENAL (1855-1930)', 'OTHER'],
  ])('%s → %s', (title, category) => {
    expect(categoryOf(title)).toBe(category)
  })
  it('reads the object in the description when the title only names the maker', () => {
    expect(categoryOf('Edmond LACHENAL (1855-1930)', 'Vase en grès émaillé')).toBe('GLASS_CERAMICS')
  })
})

describe('categorySqlConditions', () => {
  it('excludes the families that take precedence', () => {
    const { matches, excludes } = categorySqlConditions('SCULPTURE')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatch(/^\\m\(.*bronzes\?.*\)\\M$/)
    expect(excludes).toHaveLength(4)
  })
  it('defines "other" as none of the named families', () => {
    expect(categorySqlConditions('OTHER')).toEqual({ matches: [], excludes: expect.arrayContaining([expect.stringContaining('chaises?')]) })
    expect(categorySqlConditions('OTHER').excludes).toHaveLength(6)
  })
  it('has nothing before furniture', () => {
    expect(categorySqlConditions('FURNITURE').excludes).toEqual([])
  })
})
