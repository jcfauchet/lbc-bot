import { extractNuxtData, findEntryIndex, resolveDevalue } from './devalue'
import type { ArtcurialSale } from './types'

interface RawSale {
  ref?: string
  name?: string
  status?: string
  totalLots?: number
  specialties?: Array<{ specialty?: { ref?: string } }>
  vacations?: Array<{ validity?: { beginDate?: string; endDate?: string } }>
}

export function parseSalePage(html: string): ArtcurialSale | null {
  const arr = extractNuxtData(html)
  if (!arr) return null
  const index = findEntryIndex(arr, ['specialties', 'ref', 'totalLots'])
  if (index < 0) return null
  const raw = resolveDevalue(arr, index) as RawSale
  if (typeof raw.ref !== 'string') return null
  return {
    ref: raw.ref,
    name: raw.name ?? '',
    status: raw.status ?? '',
    totalLots: raw.totalLots ?? 0,
    specialties: (raw.specialties ?? [])
      .map((s) => s.specialty?.ref)
      .filter((ref): ref is string => typeof ref === 'string'),
    beginDate: raw.vacations?.[0]?.validity?.beginDate ?? null,
    endDate: raw.vacations?.[0]?.validity?.endDate ?? null,
  }
}
