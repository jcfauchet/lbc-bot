/**
 * Detects, from a listing's free text (title + body), whether the seller is
 * describing the item as a look-alike rather than an authentic piece:
 * "dans le style de", "ressemble à", "réplique", "type <designer>", etc.
 *
 * This is the signal the user repeatedly flagged as missing — the pipeline used
 * to judge the photo only and ignored sentences like "ressemble à Michel Boyer"
 * (i.e. a replica). Such listings should be downgraded, not estimated at the
 * price of the genuine designer piece.
 */

/** Phrases that, on their own, mark the item as a copy / look-alike. */
const STANDALONE = /(\bréplique\b|\breplique\b|\bimitation\b|\breproduction\b|copie de|inspir[ée]e? de|\binspiration\b|d['’]\s?après|d['’]\s?apres)/iu

/**
 * Markers that reference a designer/maker the item merely resembles. They only
 * count when followed by a proper noun (a capitalised name) so generic uses
 * like "type scandinave" or "type de meuble" are not flagged.
 */
const NAME_REFERENCE = /(?:dans le style de|style de|ressemble\s+à|à la manière de|façon|type)\s+(\S)/giu

export function hasReplicaSignal(text?: string | null): boolean {
  if (!text) return false

  if (STANDALONE.test(text)) return true

  NAME_REFERENCE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NAME_REFERENCE.exec(text)) !== null) {
    if (/\p{Lu}/u.test(match[1])) return true
  }
  return false
}
