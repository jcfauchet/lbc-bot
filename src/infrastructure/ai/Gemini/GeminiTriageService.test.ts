import { beforeEach, describe, expect, it, vi } from 'vitest'

type Request = { model: string; config?: unknown }
const generateContent = vi.fn(async (_request: Request) => ({ text: '{"score": 7}' }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent } },
}))

import { GeminiTriageService } from './GeminiTriageService'

const input = { imageUrl: 'https://img/x.jpg', title: 'Table', priceEur: 120 }

describe('GeminiTriageService', () => {
  beforeEach(() => {
    generateContent.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('jpeg'))))
  })

  it('triages on gemini-2.5-flash by default, letting the model think as it likes', async () => {
    await new GeminiTriageService('key').triage(input)
    const call = generateContent.mock.calls[0][0]
    expect(call.model).toBe('gemini-2.5-flash')
    expect(call.config).toBeUndefined()
  })

  it('pins the model and the thinking budget when asked, so an eval can compare them', async () => {
    await new GeminiTriageService('key', { model: 'gemini-3.6-flash', thinkingBudget: 0 }).triage(input)
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: 'gemini-3.6-flash', config: { thinkingConfig: { thinkingBudget: 0 } },
    })
  })
})
