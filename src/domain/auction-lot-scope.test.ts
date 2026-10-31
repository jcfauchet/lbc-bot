import { describe, expect, it } from 'vitest'
import { isUnwantedLot } from './auction-lot-scope'

describe('isUnwantedLot', () => {
  it.each([
    ['Bernard BUFFET (1928-1999)', 'Huile sur toile, signée en haut à gauche. 65 x 50 cm'],
    ['LÉPINE, "bateaux à quais", gouache sur papier', ''],
    ['Paysage animé', 'Aquarelle et rehauts de gouache'],
    ['Robert DOISNEAU', 'Tirage argentique postérieur'],
    ['Tapis Kazak', 'Laine, Caucase, vers 1900'],
    ['Pendule portique en marbre blanc', 'Époque Louis XVI'],
    ['Cartel d\'applique en bronze doré', ''],
  ])('drops "%s"', (title, description) => {
    expect(isUnwantedLot({ title, description })).toBe(true)
  })

  it.each([
    ['Suite de dix chaises mod. PK9 - 1960', 'Piètement en acier chromé, cuir noir'],
    ['Paire d\'appliques "Au vase fleuri"', 'Métal doré'],
    ['Table basse', 'Plateau en bois peint à l\'huile, piètement métal'],
    ['Miroir soleil', 'Talosel, vers 1960'],
    ['Vase "Clématites" - circa 1900', 'Verre multicouche dégagé à l\'acide'],
    ['Edmond LACHENAL (1855-1930)', 'Vase en grès émaillé'],
    ['Bronze animalier', 'Épreuve en bronze à patine brune'],
    ['Ménagère en argent', '120 pièces'],
    ['Bureau plat Louis XV', 'Dessus de cuir, tapis de jeu en feutre'],
  ])('keeps "%s"', (title, description) => {
    expect(isUnwantedLot({ title, description })).toBe(false)
  })
})
