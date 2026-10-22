import { beforeEach, describe, expect, it, vi } from 'vitest'

type Request = { model: string; output_config: { effort: string } }
const create = vi.fn(async (_request: Request) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"score": 7, "rationale": "teak"}' }],
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create } },
}))

import { ClaudeTriageService } from './ClaudeTriageService'

const input = { imageUrl: 'https://img/x.jpg', title: 'Table', priceEur: 120 }

describe('ClaudeTriageService', () => {
  beforeEach(() => {
    create.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('jpeg'), { headers: { 'content-type': 'image/jpeg' } })))
  })

  it('triages on Haiku 5.5 at low effort by default and reads the score from the text block', async () => {
    const result = await new ClaudeTriageService('key').triage(input)
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
    expect(result.score).toBe(7)
  })

  it('throws on a refusal so the fallback provider scores the ad instead of a silent 0', async () => {
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] })
    await expect(new ClaudeTriageService('key').triage(input)).rejects.toThrow(/refused/)
  })
})
