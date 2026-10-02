import { describe, it, expect } from 'vitest'
import { envSchema } from './env'

const baseEnv = { DATABASE_URL: 'postgres://user:pass@host:5432/db' }

describe('envSchema RANKING_ENABLED', () => {
  it('defaults to enabled when unset', () => {
    const parsed = envSchema.parse(baseEnv)
    expect(parsed.RANKING_ENABLED).toBe(true)
  })

  it('parses the literal string "true" as enabled', () => {
    const parsed = envSchema.parse({ ...baseEnv, RANKING_ENABLED: 'true' })
    expect(parsed.RANKING_ENABLED).toBe(true)
  })

  it('parses the literal string "false" as disabled', () => {
    const parsed = envSchema.parse({ ...baseEnv, RANKING_ENABLED: 'false' })
    expect(parsed.RANKING_ENABLED).toBe(false)
  })
})


describe('envSchema REFERENCES_KEY', () => {
  it('keeps a key of 16+ characters', () => {
    const parsed = envSchema.safeParse({ ...baseEnv, REFERENCES_KEY: 'abcdef0123456789' })
    expect(parsed.success && parsed.data.REFERENCES_KEY).toBe('abcdef0123456789')
  })
  it('drops an empty or too-short key instead of failing the whole env', () => {
    for (const value of ['', 'short']) {
      const parsed = envSchema.safeParse({ ...baseEnv, REFERENCES_KEY: value })
      expect(parsed.success).toBe(true)
      expect(parsed.success && parsed.data.REFERENCES_KEY).toBeUndefined()
    }
  })
})
