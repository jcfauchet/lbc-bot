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

/**
 * Known 20th-century designers, makers and editions. Stored accent-stripped and
 * lower-cased; matched on word boundaries. Not exhaustive on purpose — it is
 * extended as new attributions show up in feedback.
 */
const KNOWN_MAKERS = [
  'willy rizzo', 'michel boyer', 'verner panton', 'joe colombo', 'castiglioni',
  'giancarlo piretti', 'anna castelli', 'roger capron', 'jean prouve',
  'charlotte perriand', 'pierre jeanneret', 'le corbusier', 'pierre paulin',
  'eero saarinen', 'arne jacobsen', 'hans wegner', 'alvar aalto', 'isamu noguchi',
  'george nelson', 'eames', 'ettore sottsass', 'alessandro mendini',
  'philippe starck', 'gae aulenti', 'mathieu matego', 'matego', 'serge mouille',
  'pierre guariche', 'jacques adnet', 'gio ponti', 'mario sabot',
  'charles hollis jones', 'david lange', 'jacques hittier', 'henning kjaernulf',
  'michel dumas', 'gerald thurston', 'pierre cardin', 'maison jansen', 'jansen',
  'bagues', 'kartell', 'vitra', 'knoll', 'cassina', 'artemide', 'flos',
  'roche bobois', 'ligne roset', 'fontana arte', 'b&b italia', 'poltrona frau',
  'thonet', 'fritz hansen', 'herman miller', 'airborne', 'steiner', 'disderot',
  'bieffeplast',
] as const

const MAKER_PATTERNS = KNOWN_MAKERS.map(
  (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
)

/** "signée Barrois", "estampillé Jansen", "édité par X", "attribué à X". */
const ATTRIBUTION_VERB = /(?<!non\s)(?<!pas\s)\b(signe|signee|estampille|estampillee|edite par|edition de|attribue a)\s+\w/

function strip(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * True when the seller already names a known designer/maker (or explicitly
 * attributes the piece). Such listings are already priced to their value, so
 * there is no hidden margin — the strategy targets pieces whose value the seller
 * did NOT recognise.
 */
export function hasKnownDesignerAttribution(text?: string | null): boolean {
  if (!text) return false
  const norm = strip(text)
  if (MAKER_PATTERNS.some((re) => re.test(norm))) return true
  if (ATTRIBUTION_VERB.test(norm)) return true
  return false
}
