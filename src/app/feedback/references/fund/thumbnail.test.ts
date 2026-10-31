import { describe, expect, it } from 'vitest'
import { thumbnailUrl } from './thumbnail'

describe('thumbnailUrl', () => {
  it('asks Artcurial for a 320 px image', () => {
    expect(thumbnailUrl('https://www.artcurial.com/item-images/a/b.jpg?w=1024&h=1024&fit=inside')).toBe('https://www.artcurial.com/item-images/a/b.jpg?w=320&h=320&fit=inside')
  })
  it('uses the Drouot thumbnail variant', () => {
    expect(thumbnailUrl('https://cdn.drouot.com/d/lot/fullHD/67/169039/abc')).toBe('https://cdn.drouot.com/d/lot/phare/67/169039/abc')
    expect(thumbnailUrl('https://cdn.drouot.com/d/lot/full/62/180689/abc')).toBe('https://cdn.drouot.com/d/lot/phare/62/180689/abc')
  })
  it('keeps a missing photo missing', () => {
    expect(thumbnailUrl(null)).toBeNull()
  })
})
