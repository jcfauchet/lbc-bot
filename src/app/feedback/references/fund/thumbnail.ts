/**
 * A small version of a stored lot photo for the gallery: the embedding fetches large
 * images (1024 px on Artcurial's proxy, `fullHD` on the Drouot CDN), the grid does not need them.
 */
export function thumbnailUrl(url: string | null): string | null {
  if (!url) return null
  if (url.includes('artcurial.com/item-images/')) return url.replace(/\?.*$/, '?w=320&h=320&fit=inside')
  return url.replace(/\/d\/lot\/(fullHD|full)\//, '/d/lot/phare/')
}
