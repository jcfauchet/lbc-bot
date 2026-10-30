const MAX_DEPTH = 8

/** Extracts and parses the devalue-encoded `__NUXT_DATA__` payload of a Nuxt SSR page. */
export function extractNuxtData(html: string): unknown[] | null {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const parsed: unknown = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Resolves the entry at `index` of a devalue array into plain values. Array elements and
 * object property values are indices into the same array; primitives are stored as themselves.
 * Returns undefined beyond the depth cap.
 */
export function resolveDevalue(arr: unknown[], index: number, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined
  const value = arr[index]
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'number' ? resolveDevalue(arr, item, depth + 1) : item))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = typeof item === 'number' ? resolveDevalue(arr, item, depth + 1) : item
    }
    return out
  }
  return value
}

/** Index of the first plain-object entry carrying all the given keys, or -1. */
export function findEntryIndex(arr: unknown[], keys: string[]): number {
  return arr.findIndex(
    (entry) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) && keys.every((key) => key in entry),
  )
}
