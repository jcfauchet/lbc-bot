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

/** The named entities found in French catalogue copy; unknown names are left as written. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ugrave: 'ù',
  ucirc: 'û',
  ocirc: 'ô',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  oelig: 'œ',
  OElig: 'Œ',
  Eacute: 'É',
  Egrave: 'È',
  Agrave: 'À',
  Ccedil: 'Ç',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  deg: '°',
  sup2: '²',
  frac12: '½',
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
    // One pass, so a decoded '&' never starts another entity ('&#38;amp;' -> '&amp;').
    .replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, (m, body: string) => {
      if (body[0] !== '#') return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m
      const hex = body[1] === 'x' || body[1] === 'X'
      return decodeCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), m)
    })
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
