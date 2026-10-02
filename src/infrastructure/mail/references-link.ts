/** Link to the references page, keyed so she never has to look it up. */
export function referencesPageUrl(appUrl: string, key: string | undefined): string | null {
  if (!key) return null
  return `${appUrl}/feedback/references?k=${encodeURIComponent(key)}`
}
