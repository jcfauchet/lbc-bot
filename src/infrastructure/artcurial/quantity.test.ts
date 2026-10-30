import { describe, expect, it } from 'vitest'
import { parseQuantity } from './quantity'

describe('parseQuantity', () => {
  it.each([
    ['Paire de chauffeuses', 2],
    ['Suite de dix chaises mod. PK9 - 1960', 10],
    ['Ensemble de trois cintres "One, Two, Three" - circa 1984', 3],
    ['Deux cendriers', 2],
    ['Suite de 6 chaises', 6],
    ['Série de quatre appliques', 4],
    ['Table basse', 1],
    ['Lampe "Six" - 1970', 1],
    ['Suite de vingt-quatre assiettes', 24],
    ['1960 vase', 1],
    ['12 assiettes', 12],
  ])('%s → %i', (title, expected) => expect(parseQuantity(title)).toBe(expected))
})
