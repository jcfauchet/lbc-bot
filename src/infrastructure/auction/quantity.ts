const TWENTY_UNITS = ['deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']

const WORD_VALUES: Record<string, number> = {
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  'dix-sept': 17,
  'dix-huit': 18,
  'dix-neuf': 19,
  vingt: 20,
  'vingt-et-un': 21,
  'vingt-un': 21,
}

TWENTY_UNITS.forEach((unit, index) => {
  WORD_VALUES[`vingt-${unit}`] = 22 + index
})

// Longest words first so that "dix-sept" is matched before "dix".
const NUMBER_WORDS = Object.keys(WORD_VALUES)
  .sort((a, b) => b.length - a.length)
  .join('|')

const NUMBER_TOKEN = `(\\d+|${NUMBER_WORDS})`

const PAIR_PATTERN = /^paire de\b/u
const GROUP_PATTERN = new RegExp(`^(?:suite|ensemble|série|serie|lot) de ${NUMBER_TOKEN}\\b`, 'u')
const COUNTED_PATTERN = new RegExp(`^${NUMBER_TOKEN}\\s+\\p{L}`, 'u')

// No lot has more than 100 pieces: a larger leading number is a year or a model number.
const MAX_QUANTITY = 100

function toNumber(token: string): number {
  return /^\d+$/.test(token) ? Number(token) : WORD_VALUES[token]
}

/**
 * Returns the number of pieces in an Artcurial lot, read from its French title.
 * Falls back to 1 when no quantity is recognised or the parsed value exceeds 100.
 */
export function parseQuantity(title: string): number {
  const normalizedTitle = title.trim().toLowerCase()

  if (PAIR_PATTERN.test(normalizedTitle)) {
    return 2
  }

  const groupMatch = GROUP_PATTERN.exec(normalizedTitle)
  if (groupMatch) {
    return withinLimit(toNumber(groupMatch[1]))
  }

  const countedMatch = COUNTED_PATTERN.exec(normalizedTitle)
  if (countedMatch) {
    const quantity = toNumber(countedMatch[1])
    if (quantity >= 2) {
      return withinLimit(quantity)
    }
  }

  return 1
}

function withinLimit(quantity: number): number {
  return quantity <= MAX_QUANTITY ? quantity : 1
}
