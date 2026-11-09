import { describe, expect, it } from 'vitest'
import { isCopy, isMatchableLot, isUncountedGroup } from './auction-match-scope'

describe('isMatchableLot', () => {
  it.each([
    ['Guéridon bas - circa 1949', 1],
    ["PAIRE D'APPLIQUES DE STYLE LOUIS XV", 2],
    ['Suite de six chaises mod. PK9 - 1960', 6],
    ['Miroir soleil en talosel', 1],
  ])('keeps %s', (title, quantity) => {
    expect(isMatchableLot({ title, quantity })).toBe(true)
  })

  // The alerts of 1–9 Nov 2026 that the reseller found useless.
  it.each([
    ['Le Prophète - 1992', 1],
    ['Fort lot de voitures et camions anciens et modernes DINKY TOYS', 1],
    ['Lot de pièces en argent comprenant : 2 x 50 Francs Hercule', 1],
    ['Ours blanc – modèle créé en 1922', 1],
    ['Un globe de mariée. Coussin de tissu rouge capitonné', 1],
    ['BOURAINE Marcel-André, d\'après, sous le pseudonyme DENIS', 1],
  ])('drops %s', (title, quantity) => {
    expect(isMatchableLot({ title, quantity })).toBe(false)
  })

  it('drops a group of furniture whose piece count was not read', () => {
    expect(isMatchableLot({ title: 'SUITE DE TRENTE-TROIS DÉPARTS D’ESCALIER, TRAVAIL MODERNE, TABLES', quantity: 1 })).toBe(false)
  })

  it('reads the object in the description when the title only names the maker', () => {
    expect(isMatchableLot({ title: 'Jean PROUVÉ (1901-1984)', description: 'Table dite Compas', quantity: 1 })).toBe(true)
  })
})

describe('isUncountedGroup', () => {
  it.each(['Ensemble comprenant deux fauteuils', "Réunion d'appliques", 'Important lot de chaises', 'Collection de lampes'])('%s', (title) => {
    expect(isUncountedGroup({ title, quantity: 1 })).toBe(true)
  })
  it('keeps a counted group', () => {
    expect(isUncountedGroup({ title: 'Suite de quatre chaises', quantity: 4 })).toBe(false)
  })
  it('does not read "lot" inside a word', () => {
    expect(isUncountedGroup({ title: 'Lotus, lampe de table', quantity: 1 })).toBe(false)
  })
})

describe('isCopy', () => {
  it.each(['Reproduction du célèbre ours Pompon', 'Copie de la chaise Tulip', 'Réplique Eames lounge chair'])('%s', (title) => {
    expect(isCopy(title)).toBe(true)
  })
  it.each(['Table basse année 40 50', 'Fauteuil copieusement rembourré'])('not %s', (title) => {
    expect(isCopy(title)).toBe(false)
  })
})
