import { describe, expect, it } from 'vitest'
import { listingImageUrls, MAX_IMAGES_PER_LISTING } from './listing-image-urls'

const img = (hash: string, rule = 'ad-image') =>
  `https://img.leboncoin.fr/api/v1/lbcpb1/images/${hash}.jpg?rule=${rule}`

describe('listingImageUrls', () => {
  it('keeps the cover first and appends the other photos as small variants', () => {
    const urls = listingImageUrls({ small_url: img('aa', 'ad-small'), urls: [img('aa'), img('bb'), img('cc')] })
    expect(urls).toEqual([img('aa', 'ad-small'), img('bb', 'ad-small'), img('cc', 'ad-small')])
  })

  it('falls back to the cover alone when the ad lists no urls', () => {
    expect(listingImageUrls({ small_url: img('aa', 'ad-small') })).toEqual([img('aa', 'ad-small')])
  })

  it('returns nothing when the ad has no images', () => {
    expect(listingImageUrls(undefined)).toEqual([])
    expect(listingImageUrls({})).toEqual([])
  })

  it('caps the number of photos per listing', () => {
    const urls = Array.from({ length: 12 }, (_, i) => img(`h${i}`))
    expect(listingImageUrls({ small_url: img('h0', 'ad-small'), urls })).toHaveLength(MAX_IMAGES_PER_LISTING)
  })

  it('does not duplicate the cover when it is also listed in urls under another rule', () => {
    const urls = listingImageUrls({ small_url: img('aa', 'ad-small'), urls: [img('aa', 'ad-large'), img('bb')] })
    expect(urls).toEqual([img('aa', 'ad-small'), img('bb', 'ad-small')])
  })
})
