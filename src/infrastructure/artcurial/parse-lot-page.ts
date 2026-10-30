import { extractNuxtData, findEntryIndex, resolveDevalue } from './devalue'
import type { ArtcurialLot } from './types'

interface RawLot {
  index?: number
  subIndex?: string
  status?: string
  saleRef?: string
  low?: number
  high?: number
  adjudicationPrice?: number
  adjudicationDate?: string
  finalPrice?: number
  pictures?: Array<{ document?: { servingUrl?: string } }>
  artist?: { party?: { fullName?: string }; yearOfBirth?: number; yearOfDeath?: number } | null
  descriptions?: { FRENCH?: { titleWithHtml?: string; descriptionWithHtml?: string } }
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
}

function decodeCodePoint(code: number, original: string): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return original
  }
}

export function stripHtml(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => decodeCodePoint(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec: string) => decodeCodePoint(parseInt(dec, 10), m))
    .replace(/&(nbsp|quot|apos|lt|gt);/g, (_m, name: string) => NAMED_ENTITIES[name])
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

export function parseLotPage(html: string): ArtcurialLot | null {
  const arr = extractNuxtData(html)
  if (!arr) return null
  const index = findEntryIndex(arr, ['adjudicationPrice', 'descriptions', 'index'])
  if (index < 0) return null
  const raw = resolveDevalue(arr, index) as RawLot
  if (typeof raw.saleRef !== 'string' || raw.index === undefined) return null

  const artist = raw.artist?.party?.fullName ?? null
  const french = raw.descriptions?.FRENCH
  return {
    saleRef: raw.saleRef,
    lotRef: `${raw.index}-${raw.subIndex ?? ''}`,
    status: raw.status ?? '',
    title: stripHtml(french?.titleWithHtml),
    description: stripHtml(french?.descriptionWithHtml),
    artist,
    artistYears: raw.artist && artist ? `${raw.artist.yearOfBirth ?? ''}-${raw.artist.yearOfDeath ?? ''}` : null,
    estimateLowEur: num(raw.low),
    estimateHighEur: num(raw.high),
    hammerEur: num(raw.adjudicationPrice),
    finalEur: num(raw.finalPrice),
    soldAt: raw.adjudicationDate ?? null,
    pictureUrls: (raw.pictures ?? [])
      .map((p) => p.document?.servingUrl)
      .filter((url): url is string => typeof url === 'string'),
  }
}
