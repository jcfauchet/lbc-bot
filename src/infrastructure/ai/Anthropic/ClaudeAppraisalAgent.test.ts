import { beforeEach, describe, expect, it, vi } from 'vitest'

type Tool = { name: string }
type Request = { model: string; tools: Tool[]; messages: Array<{ role: string; content: unknown }> }
type Block = { type: string; [key: string]: unknown }
const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } }
const turn = (content: Block[], stop_reason = 'tool_use', searches = 0) => ({
  stop_reason, content, usage: { ...usage, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } },
})
const inspect = (id: string, url: string): Block => ({ type: 'tool_use', id, name: 'inspect_page', input: { url } })
const submit = (urls: string[]): Block => ({
  type: 'tool_use', id: 'final', name: 'submit_appraisal', input: { identification: 'Romeo Rega bar cart', same_model_urls: urls, notes: 'Matched on the wheels.' },
})

const create = vi.fn(async (_request: Request) => turn([], 'end_turn'))
// The agent keeps appending to one messages array: record a copy of each request as sent.
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: (request: Request) => create(structuredClone(request)) } } }))
vi.mock('./claude-message', () => ({
  imageBlock: vi.fn(async (url: string) => {
    if (url.includes('broken')) throw new Error('Image download failed (404)')
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: url } }
  }),
}))
const fetchProductPage = vi.fn(async (url: string) => (url.includes('blocked')
  ? null
  : { title: `Page ${url}`, price: { value: 1000, currency: 'EUR' }, photos: [`${url}/1.jpg`] }))
vi.mock('@/infrastructure/comps/product-page-photos', () => ({ fetchProductPage: (url: string) => fetchProductPage(url) }))

import { ClaudeAppraisalAgent } from './ClaudeAppraisalAgent'

const input = { title: 'Desserte verre fumé laiton', priceEur: 120, imageUrls: ['https://img/ad1.jpg', 'https://img/ad2.jpg'] }

beforeEach(() => {
  create.mockReset()
  fetchProductPage.mockClear()
})

describe('ClaudeAppraisalAgent', () => {
  it('inspects pages, then keeps only the submitted comparables it really opened', async () => {
    create
      .mockResolvedValueOnce(turn([inspect('t1', 'https://www.pamono.com/a'), inspect('t2', 'https://www.1stdibs.com/blocked')], 'tool_use', 2))
      .mockResolvedValueOnce(turn([submit(['https://www.pamono.com/a', 'https://www.1stdibs.com/blocked', 'https://www.chairish.com/never-opened'])]))

    const appraisal = await new ClaudeAppraisalAgent('key').appraise(input)

    expect(appraisal.identification).toBe('Romeo Rega bar cart')
    expect(appraisal.comps.map((c) => c.link)).toEqual(['https://www.pamono.com/a'])
    expect(appraisal.comps[0].price).toEqual({ value: 1000, currency: 'EUR' })
    expect(appraisal.cost).toMatchObject({ turns: 2, webSearches: 2, pagesInspected: 2 })
    expect(appraisal.cost.usd).toBeCloseTo(2 * (1000 * 2 + 100 * 10) / 1e6 + 0.02)

    const [first, second] = create.mock.calls.map((c) => c[0])
    expect(first.model).toBe('claude-sonnet-5-5')
    const opening = first.messages[0].content as Block[]
    expect(opening.filter((b) => b.type === 'image')).toHaveLength(2)
    const results = second.messages[2].content as Array<{ is_error?: boolean; content: Block[] }>
    expect(results[0].content.filter((b) => b.type === 'image')).toHaveLength(1)
    expect(results[1].content[0].text).toContain('Could not read this page')
  })

  it('opens with the Lens leads and their thumbnails after the ad photos', async () => {
    create.mockResolvedValueOnce(turn([submit([])]))
    await new ClaudeAppraisalAgent('key').appraise({
      ...input,
      leads: [
        { title: 'Romeo Rega cart', link: 'https://www.pamono.com/rr', source: 'Pamono', isValueDomain: true, imageUrl: 'https://tbn/rr' },
        { title: 'No thumbnail', link: 'https://www.chairish.com/x', source: 'Chairish', isValueDomain: true },
        { title: 'The ad itself', link: 'https://www.leboncoin.fr/ad/1', source: 'Leboncoin', isValueDomain: false, imageUrl: 'https://tbn/ad' },
      ],
    })
    const opening = create.mock.calls[0][0].messages[0].content as Block[]
    const texts = opening.filter((b) => b.type === 'text').map((b) => b.text as string)
    expect(texts.some((t) => t.startsWith('Lead 1: [Pamono] Romeo Rega cart'))).toBe(true)
    expect(texts.some((t) => t.includes('leboncoin'))).toBe(false)
    expect(opening.filter((b) => b.type === 'image')).toHaveLength(3)
  })

  it('resumes a paused server-side search without adding a user turn', async () => {
    create
      .mockResolvedValueOnce(turn([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], 'pause_turn', 3))
      .mockResolvedValueOnce(turn([submit([])]))
    const appraisal = await new ClaudeAppraisalAgent('key').appraise(input)
    expect(appraisal.comps).toEqual([])
    expect(create.mock.calls[1][0].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('withdraws web search once the budget is spent and refuses inspections past it', async () => {
    const agent = new ClaudeAppraisalAgent('key', 'claude-sonnet-5-5', 'medium', { maxTurns: 6, maxSearches: 2, maxInspections: 1 })
    create
      .mockResolvedValueOnce(turn([inspect('t1', 'https://a.example/1'), inspect('t2', 'https://a.example/2')], 'tool_use', 2))
      .mockResolvedValueOnce(turn([submit(['https://a.example/1', 'https://a.example/2'])]))
    const appraisal = await agent.appraise(input)
    expect(appraisal.comps.map((c) => c.link)).toEqual(['https://a.example/1'])
    expect(fetchProductPage).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].tools.map((t) => t.name)).toContain('web_search')
    expect(create.mock.calls[1][0].tools.map((t) => t.name)).toEqual(['inspect_page', 'submit_appraisal'])
  })

  it('asks for the submission on the last turn and returns nothing found when it never comes', async () => {
    const agent = new ClaudeAppraisalAgent('key', 'claude-sonnet-5-5', 'medium', { maxTurns: 3, maxSearches: 6, maxInspections: 8 })
    create.mockResolvedValue(turn([inspect('t', 'https://a.example/x')]))
    const appraisal = await agent.appraise(input)
    expect(create).toHaveBeenCalledTimes(3)
    const lastUserTurn = create.mock.calls[2][0].messages.at(-1)!.content as Block[]
    expect(lastUserTurn.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('call submit_appraisal now') })
    expect(appraisal).toMatchObject({ comps: [], notes: expect.stringContaining('without submitting') })
  })

  it('throws on a refusal, and when no ad photo can be loaded', async () => {
    create.mockResolvedValueOnce(turn([], 'refusal'))
    await expect(new ClaudeAppraisalAgent('key').appraise(input)).rejects.toThrow('refused')
    await expect(new ClaudeAppraisalAgent('key').appraise({ ...input, imageUrls: ['https://img/broken.jpg'] })).rejects.toThrow('No ad photo')
  })

  it('never opens a Leboncoin page', async () => {
    create
      .mockResolvedValueOnce(turn([inspect('t1', 'https://www.leboncoin.fr/ad/123')]))
      .mockResolvedValueOnce(turn([submit(['https://www.leboncoin.fr/ad/123'])]))
    const appraisal = await new ClaudeAppraisalAgent('key').appraise(input)
    expect(fetchProductPage).not.toHaveBeenCalled()
    expect(appraisal.comps).toEqual([])
  })
})
