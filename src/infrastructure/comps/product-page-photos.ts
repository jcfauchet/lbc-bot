/**
 * Sharp photos of a comparable, read from the dealer's own product page.
 *
 * Lens only hands back a ~100px Google thumbnail, too blurry for anyone (the
 * user or a model) to tell a model from a look-alike: on 22 Oct 2026 the user
 * rejected 7 of the 11 comps both Claude and Gemini had confirmed from those
 * thumbnails. Chairish, 1stDibs and Pamono all publish full-size photos in
 * og:image and their JSON-LD Product markup.
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const PAGE_TIMEOUT_MS = 10_000
export const MAX_PRODUCT_PHOTOS = 3

function decodeEntities(url: string): string {
  return url.replace(/&amp;/g, '&')
}

function jsonLdImages(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(jsonLdImages)
  if (!node || typeof node !== 'object') return []
  const record = node as Record<string, unknown>
  const own = record.image === undefined ? [] : [record.image].flat().flatMap((image): string[] => {
    if (typeof image === 'string') return [image]
    const asObject = image as { url?: unknown; contentUrl?: unknown } | null
    const url = asObject?.url ?? asObject?.contentUrl
    return typeof url === 'string' ? [url] : []
  })
  return [...own, ...jsonLdImages(record['@graph'])]
}

/** og:image first (the dealer's chosen cover), then JSON-LD images, one per photo whatever its size variant. */
export function extractProductPhotos(html: string, pageUrl: string): string[] {
  const og = [...html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1])
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    try {
      return jsonLdImages(JSON.parse(m[1]))
    } catch {
      return []
    }
  })
  const seen = new Set<string>()
  const photos: string[] = []
  for (const raw of [...og, ...ld]) {
    let url: URL
    try {
      url = new URL(decodeEntities(raw), pageUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:') continue
    // Size variants of one photo differ only by query string (?width=768, ?height=1600).
    const key = `${url.host}${url.pathname}`
    if (seen.has(key)) continue
    seen.add(key)
    photos.push(url.toString())
  }
  return photos
}

export interface ProductPrice {
  value: number
  currency: string
}

function jsonLdOffers(node: unknown): ProductPrice[] {
  if (Array.isArray(node)) return node.flatMap(jsonLdOffers)
  if (!node || typeof node !== 'object') return []
  const record = node as Record<string, unknown>
  const own = record.offers === undefined ? [] : [record.offers].flat().flatMap((offer): ProductPrice[] => {
    const o = offer as { price?: unknown; lowPrice?: unknown; priceCurrency?: unknown } | null
    const value = Number(o?.price ?? o?.lowPrice)
    return Number.isFinite(value) && value > 0 && typeof o?.priceCurrency === 'string'
      ? [{ value, currency: o.priceCurrency.toUpperCase() }]
      : []
  })
  return [...own, ...jsonLdOffers(record['@graph'])]
}

/**
 * The asking price the page itself publishes, from JSON-LD Product offers, else
 * the og/product:price meta tags. Null when the page states none: an appraiser
 * must never price a comparable from a number it read or remembered elsewhere.
 */
export function extractProductPrice(html: string): ProductPrice | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const [offer] = jsonLdOffers(JSON.parse(m[1]))
      if (offer) return offer
    } catch {
      continue
    }
  }
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+property=["'](?:og|product):price:${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
  const value = Number(meta('amount'))
  const currency = meta('currency')
  return Number.isFinite(value) && value > 0 && currency ? { value, currency: currency.toUpperCase() } : null
}

export interface ProductPage {
  title: string | null
  price: ProductPrice | null
  photos: string[]
}

/**
 * The product page's title, published price and up to `max` photos, or null when
 * the page is unreachable, blocks bots, or redirects elsewhere: a sold item often
 * redirects to another product, whose photos would be compared in its place.
 */
export async function fetchProductPage(link: string, max = MAX_PRODUCT_PHOTOS): Promise<ProductPage | null> {
  try {
    const response = await fetch(link, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!response.ok) return null
    if (response.url && new URL(response.url).pathname !== new URL(link).pathname) return null
    const html = await response.text()
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    return {
      title: title ? decodeEntities(title).trim() : null,
      price: extractProductPrice(html),
      photos: extractProductPhotos(html, link).slice(0, max),
    }
  } catch {
    return null
  }
}

/** Up to `max` photos from the product page, or [] when it cannot be used (see fetchProductPage). */
export async function fetchProductPhotos(link: string, max = MAX_PRODUCT_PHOTOS): Promise<string[]> {
  return (await fetchProductPage(link, max))?.photos ?? []
}
