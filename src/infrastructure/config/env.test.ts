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

describe('envSchema Lens budget', () => {
  it('follows the configured providers when unset', () => {
    expect(envSchema.parse(baseEnv)).toMatchObject({ LENS_DAILY_BUDGET: 8, LENS_MONTHLY_BUDGET: 250 })
    expect(envSchema.parse({ ...baseEnv, APIFY_TOKEN: 'tok' })).toMatchObject({ LENS_DAILY_BUDGET: 24, LENS_MONTHLY_BUDGET: 750 })
  })

  it('keeps an explicit value', () => {
    expect(envSchema.parse({ ...baseEnv, APIFY_TOKEN: 'tok', LENS_DAILY_BUDGET: '12' })).toMatchObject({ LENS_DAILY_BUDGET: 12, LENS_MONTHLY_BUDGET: 750 })
  })
})

describe('envSchema APPRAISAL_AGENT_ENABLED', () => {
  it('is on by default and only "false" turns it off', () => {
    expect(envSchema.parse(baseEnv).APPRAISAL_AGENT_ENABLED).toBe(true)
    expect(envSchema.parse({ ...baseEnv, APPRAISAL_AGENT_ENABLED: 'false' }).APPRAISAL_AGENT_ENABLED).toBe(false)
  })
})
