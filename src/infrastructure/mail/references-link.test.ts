import { describe, it, expect } from 'vitest'
import { referencesPageUrl } from './references-link'

describe('referencesPageUrl', () => {
  it('builds the keyed page URL', () => {
    expect(referencesPageUrl('https://bot.example.com', 'abc def/123'))
      .toBe('https://bot.example.com/feedback/references?k=abc%20def%2F123')
  })
  it('is null without a key, so emails hide the button', () => {
    expect(referencesPageUrl('https://bot.example.com', undefined)).toBeNull()
    expect(referencesPageUrl('https://bot.example.com', '')).toBeNull()
  })
})
