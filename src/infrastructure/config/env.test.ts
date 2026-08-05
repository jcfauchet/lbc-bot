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
