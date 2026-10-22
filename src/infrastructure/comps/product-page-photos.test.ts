import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractProductPhotos, fetchProductPhotos } from './product-page-photos'

const page = `
<meta property="og:image" content="https://cdn.example/p/1.jpg?width=768&amp;q=80">
<script type="application/ld+json">{"@type":"Product","image":["https://cdn.example/p/1.jpg?width=1600","https://cdn.example/p/2.jpg",{"url":"/p/3.jpg"}]}</script>
<script type="application/ld+json">{"@graph":[{"@type":"Product","image":{"contentUrl":"https://cdn.example/p/4.jpg"}}]}</script>
<script type="application/ld+json">not json</script>`

describe('extractProductPhotos', () => {
  it('lists og:image first, then JSON-LD images, one entry per photo whatever its size variant', () => {
    expect(extractProductPhotos(page, 'https://dealer.example/item/42')).toEqual([
      'https://cdn.example/p/1.jpg?width=768&q=80',
      'https://cdn.example/p/2.jpg',
      'https://dealer.example/p/3.jpg',
      'https://cdn.example/p/4.jpg',
    ])
  })

  it('finds nothing on a page without product markup', () => {
    expect(extractProductPhotos('<html><body>Sold</body></html>', 'https://dealer.example/x')).toEqual([])
  })
})

describe('fetchProductPhotos', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubFetch = (response: Partial<Response> & { text?: () => Promise<string> }) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, url: 'https://dealer.example/item/42', text: async () => page, ...response })))

  it('caps the photos it returns', async () => {
    stubFetch({})
    expect(await fetchProductPhotos('https://dealer.example/item/42', 2)).toHaveLength(2)
  })

  it('ignores a page that redirected to another product, as sold items do', async () => {
    stubFetch({ url: 'https://dealer.example/item/99' })
    expect(await fetchProductPhotos('https://dealer.example/item/42')).toEqual([])
  })

  it('returns nothing when the page is blocked or unreachable', async () => {
    stubFetch({ ok: false })
    expect(await fetchProductPhotos('https://dealer.example/item/42')).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect(await fetchProductPhotos('https://dealer.example/item/42')).toEqual([])
  })
})
