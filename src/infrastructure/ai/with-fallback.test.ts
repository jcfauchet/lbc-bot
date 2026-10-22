import { describe, expect, it, vi } from 'vitest'
import { withFallback } from './with-fallback'

interface Port { readonly providerName: string; answer(n: number): Promise<string> }

describe('withFallback', () => {
  it('answers from the primary while it works', async () => {
    const fallback = { providerName: 'gemini', answer: vi.fn(async () => 'gemini') }
    const port = withFallback<Port>({ providerName: 'claude', answer: async (n) => `claude ${n}` }, fallback, 'Test')
    expect(await port.answer(1)).toBe('claude 1')
    expect(port.providerName).toBe('claude')
    expect(fallback.answer).not.toHaveBeenCalled()
  })

  it('replays the same call on the fallback when the primary throws, e.g. once the spend limit is hit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const primary: Port = { providerName: 'claude', answer: async () => { throw new Error('429 spend limit') } }
    const port = withFallback<Port>(primary, { providerName: 'gemini', answer: async (n) => `gemini ${n}` }, 'Test')
    expect(await port.answer(2)).toBe('gemini 2')
  })

  it('surfaces the fallback error when both fail, so the caller keeps its own last resort', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = (msg: string): Port => ({ providerName: msg, answer: async () => { throw new Error(msg) } })
    await expect(withFallback(failing('claude'), failing('gemini'), 'Test').answer(3)).rejects.toThrow('gemini')
  })
})
