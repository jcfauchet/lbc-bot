const MONTHS: Record<string, string> = {
  janvier: '01',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  décembre: '12',
}

/** "mercredi 31 décembre 2025 à 14h00" -> "2025-12-31"; null when no date is found. */
export function parseFrenchDate(line: string): string | null {
  const match = /(\d{1,2})(?:er)?\s+([a-zéûè]+)\s+(\d{4})/i.exec(line)
  if (!match) return null
  const month = MONTHS[match[2].toLowerCase()]
  if (!month) return null
  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`
}
