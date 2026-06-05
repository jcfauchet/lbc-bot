export const VALUE_DOMAINS = [
  'selency', '1stdibs', 'pamono', 'design-market', 'drouot', 'interencheres',
  'auction.fr', 'auctionet', 'catawiki', 'sothebys', 'christies', 'artsy',
  'invaluable', 'chairish', 'vinterior', 'proantic', 'expertissim', 'lot-art',
  'incollect', 'lauritz', 'ragoarts', 'michaans',
] as const

export function isValueDomain(urlOrSource: string): boolean {
  const haystack = urlOrSource.toLowerCase()
  return VALUE_DOMAINS.some((d) => haystack.includes(d))
}
