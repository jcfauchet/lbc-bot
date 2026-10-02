import { timingSafeEqual } from 'node:crypto'

export function isReferencesKeyValid(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
