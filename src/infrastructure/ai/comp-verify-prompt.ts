export function buildCompVerifyPrompt(input: { listingTitle: string; compCount: number }): string {
  return [
    'You help a vintage furniture reseller price a piece from a second-hand ad.',
    `The first image is the ad photo, titled "${input.listingTitle}".`,
    `The next ${input.compCount} images are candidate comparables found by reverse-image search, numbered 1 to ${input.compCount} in order.`,
    'A candidate counts only if it shows the SAME model/design as the ad piece (same maker or a faithful edition),',
    'judged on form, proportions, materials and construction details. Ignore colour cast, lighting, background,',
    'condition and photo angle. A piece that is merely the same kind of object, the same style or a look-alike does NOT count.',
    'Reply with strict JSON: {"confirmed": [<numbers of the candidates that are the same model>]}',
    'An empty list is a valid answer.',
  ].join('\n')
}

/** One flag per candidate, from 1-based indices. Anything unparseable confirms nothing. */
export function parseCompVerdicts(raw: string, compCount: number): boolean[] {
  const flags = Array.from({ length: compCount }, () => false)
  const object = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return flags
  try {
    const parsed = JSON.parse(object) as { confirmed?: unknown }
    if (!Array.isArray(parsed.confirmed)) return flags
    for (const n of parsed.confirmed) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= compCount) flags[n - 1] = true
    }
  } catch {
    return flags
  }
  return flags
}
