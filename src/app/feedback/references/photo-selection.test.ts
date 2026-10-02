import { describe, it, expect } from 'vitest'
import { addPhotos, removePhoto, MAX_PHOTOS } from './photo-selection'

const f = (name: string) => ({ name })

describe('photo selection', () => {
  it('appends new picks to the ones already chosen', () => {
    expect(addPhotos([f('a')], [f('b'), f('c')]).map((p) => p.name)).toEqual(['a', 'b', 'c'])
  })
  it('never keeps more than the maximum', () => {
    const many = Array.from({ length: 7 }, (_, i) => f(`p${i}`))
    expect(addPhotos([f('a')], many)).toHaveLength(MAX_PHOTOS)
  })
  it('removes one photo by position', () => {
    expect(removePhoto([f('a'), f('b'), f('c')], 1).map((p) => p.name)).toEqual(['a', 'c'])
  })
})
