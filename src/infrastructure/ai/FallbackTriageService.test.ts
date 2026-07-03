import { describe, it, expect, vi } from 'vitest'
import { FallbackTriageService } from './FallbackTriageService'
import type { ITriageService } from '@/domain/services/ITriageService'

const stub = (name: string, impl: () => Promise<{ score: number }>): ITriageService => ({
  providerName: name, triage: vi.fn(impl),
})

const input = { imageUrl: 'u', title: 't', priceEur: 50 }

describe('FallbackTriageService', () => {
  it('uses the primary when it succeeds', async () => {
    const primary = stub('gemini', async () => ({ score: 7 }))
    const fallback = stub('openai', async () => ({ score: 1 }))
    const svc = new FallbackTriageService(primary, fallback)
    expect((await svc.triage(input)).score).toBe(7)
    expect(fallback.triage).not.toHaveBeenCalled()
  })

  it('falls back when the primary throws', async () => {
    const primary = stub('gemini', async () => { throw new Error('rate limit') })
    const fallback = stub('openai', async () => ({ score: 4 }))
    const svc = new FallbackTriageService(primary, fallback)
    expect((await svc.triage(input)).score).toBe(4)
    expect(fallback.triage).toHaveBeenCalledOnce()
  })
})
