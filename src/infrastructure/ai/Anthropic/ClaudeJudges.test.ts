import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompMatch } from '@/domain/services/ICompService'

type Block = { type: string; text?: string }
type Request = { model: string; messages: Array<{ content: Block[] | string }> }
const reply = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] })
const create = vi.fn(async (_request: Request) => reply('{}'))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))
vi.mock('../fetch-image', () => ({
  fetchImage: vi.fn(async (url: string) => {
    if (url.includes('broken')) throw new Error('Image download failed (404)')
    return { mimeType: 'image/jpeg', data: `img:${url}` }
  }),
}))

import { ClaudeCompVerifier } from './ClaudeCompVerifier'
import { ClaudeSelectionRanker } from './ClaudeSelectionRanker'
import { ClaudeReferenceMatchVerifier } from './ClaudeReferenceMatchVerifier'
import { ClaudeFeedbackLearningService } from './ClaudeFeedbackLearningService'

const blocks = (call: Request) => call.messages[0].content as Block[]
const comp = (link: string, imageUrl?: string): CompMatch => ({
  title: link, link, source: 'selency', isValueDomain: true, price: { value: 500, currency: 'EUR' }, imageUrl,
})

beforeEach(() => create.mockReset())

describe('ClaudeCompVerifier', () => {
  it('keeps only the confirmed comparables, on Opus, with the ad photo first', async () => {
    create.mockResolvedValueOnce(reply('{"confirmed": [2]}'))
    const comps = [comp('a', 'https://t/a'), comp('b', 'https://t/b'), comp('c')]
    const kept = await new ClaudeCompVerifier('key').verify({ listingImageUrls: ['https://img/ad.jpg'], listingTitle: 'Table', comps })
    expect(kept.map((c) => c.link)).toEqual(['b'])
    const call = create.mock.calls[0][0]
    expect(call.model).toBe('claude-opus-5-5')
    expect(blocks(call).filter((b) => b.type === 'image')).toHaveLength(3)
  })

  it('throws on a refusal so the Gemini verifier decides instead of confirming nothing', async () => {
    create.mockResolvedValueOnce(reply('', 'refusal'))
    await expect(new ClaudeCompVerifier('key').verify({ listingImageUrls: ['https://img/ad.jpg'], listingTitle: 'Table', comps: [comp('a', 'https://t/a')] }))
      .rejects.toThrow(/refused/)
  })
})

describe('ClaudeSelectionRanker', () => {
  const candidate = (listingId: string, imageUrl: string) => ({ listingId, imageUrl, title: listingId, priceEur: 100 })

  it('drops a candidate whose image is gone and numbers the rest in order', async () => {
    create.mockResolvedValueOnce(reply('{"picks": [{"candidate": 1, "worthCredit": true}]}'))
    const picks = await new ClaudeSelectionRanker('key').rank([candidate('gone', 'https://broken'), candidate('ok', 'https://img/ok')])
    expect(picks.map((p) => p.listingId)).toEqual(['ok'])
    expect(blocks(create.mock.calls[0][0]).filter((b) => b.type === 'image')).toHaveLength(1)
  })

  it('treats an unparseable reply as a broken call, not an abstention', async () => {
    create.mockResolvedValueOnce(reply('no idea'))
    await expect(new ClaudeSelectionRanker('key').rank([candidate('ok', 'https://img/ok')])).rejects.toThrow(/parsed/)
  })
})

describe('ClaudeReferenceMatchVerifier', () => {
  it('sends listing photos then reference photos and parses the verdict', async () => {
    create.mockResolvedValueOnce(reply('{"same": true, "reason": "same base"}'))
    const verdict = await new ClaudeReferenceMatchVerifier('key').verify({
      listingImageUrls: ['https://l/1', 'https://l/2'], listingTitle: 'Lampe', referenceImageUrls: ['https://r/1'], referenceName: 'Atollo', referenceNote: null,
    })
    expect(verdict).toEqual({ same: true, reason: 'same base' })
    expect(blocks(create.mock.calls[0][0]).filter((b) => b.type === 'image')).toHaveLength(3)
  })
})

describe('ClaudeFeedbackLearningService', () => {
  it('skips the call when there is no feedback to learn from', async () => {
    expect(await new ClaudeFeedbackLearningService('key').distil([], [])).toBe('')
    expect(create).not.toHaveBeenCalled()
  })
})
