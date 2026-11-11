import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiCostUsd, claudeUsage, geminiUsage, recordAiUsage, setAiUsageSink, type AiUsageEvent } from './ai-usage'
import { AiUsageBuffer, type AiUsageTotals } from './AiUsageBuffer'

afterEach(() => setAiUsageSink(null))

describe('aiCostUsd', () => {
  it('prices input, output and cached tokens per million', () => {
    expect(aiCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000 })).toBeCloseTo(4 + 2 + 0.2)
    expect(aiCostUsd('gemini-3.6-flash', { inputTokens: 2_000_000, outputTokens: 1_000_000 })).toBeCloseTo(1.5 + 3.75)
  })

  it('prices image embeddings per image', () => {
    expect(aiCostUsd('gemini-embedding-2-preview', { images: 1000 })).toBeCloseTo(0.12)
  })

  it('counts an unknown model at zero', () => {
    expect(aiCostUsd('some-new-model', { inputTokens: 1_000_000 })).toBe(0)
  })
})

describe('recordAiUsage', () => {
  it('does nothing without a sink', () => {
    expect(() => recordAiUsage('triage', 'claude-haiku-5-5', { inputTokens: 10 })).not.toThrow()
  })

  it('sends the stage, model, tokens and cost to the sink', () => {
    const events: AiUsageEvent[] = []
    setAiUsageSink((e) => events.push(e))
    recordAiUsage('triage', 'claude-haiku-5-5', claudeUsage({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: null }))
    expect(events).toEqual([{ stage: 'triage', model: 'claude-haiku-5-5', inputTokens: 1500, outputTokens: 200, costUsd: expect.closeTo(0.000205, 9) }])
  })

  it('does not throw when the sink does', () => {
    setAiUsageSink(() => { throw new Error('db down') })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => recordAiUsage('ranking', 'claude-opus-5-5', {})).not.toThrow()
    log.mockRestore()
  })

  it('bills Gemini thinking tokens as output', () => {
    expect(geminiUsage({ promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 40 })).toEqual({ inputTokens: 100, outputTokens: 50 })
    expect(geminiUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})

describe('AiUsageBuffer', () => {
  const event = (stage: AiUsageEvent['stage'], model: string, costUsd: number): AiUsageEvent => ({ stage, model, inputTokens: 100, outputTokens: 10, costUsd })

  it('writes one row per stage and model at flush', async () => {
    const written: AiUsageTotals[][] = []
    const buffer = new AiUsageBuffer(async (rows) => { written.push(rows) })
    buffer.add(event('triage', 'claude-haiku-5-5', 0.01))
    buffer.add(event('triage', 'claude-haiku-5-5', 0.02))
    buffer.add(event('ranking', 'claude-opus-5-5', 0.2))
    await buffer.flush()
    await buffer.flush()
    expect(written).toHaveLength(1)
    expect(written[0]).toEqual([
      { stage: 'triage', model: 'claude-haiku-5-5', calls: 2, inputTokens: 200, outputTokens: 20, costUsd: expect.closeTo(0.03, 9) },
      { stage: 'ranking', model: 'claude-opus-5-5', calls: 1, inputTokens: 100, outputTokens: 10, costUsd: 0.2 },
    ])
  })

  it('flushes on its own once the interval has passed', async () => {
    let now = 0
    const write = vi.fn(async () => {})
    const buffer = new AiUsageBuffer(write, 30_000, () => now)
    buffer.add(event('triage', 'claude-haiku-5-5', 0.01))
    expect(write).not.toHaveBeenCalled()
    now = 30_000
    buffer.add(event('triage', 'claude-haiku-5-5', 0.01))
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps the rows of a failed write for the next flush', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const write = vi.fn<(rows: AiUsageTotals[]) => Promise<void>>().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined)
    const buffer = new AiUsageBuffer(write)
    buffer.add(event('triage', 'claude-haiku-5-5', 0.01))
    await buffer.flush()
    buffer.add(event('triage', 'claude-haiku-5-5', 0.01))
    await buffer.flush()
    expect(write.mock.calls[1][0]).toEqual([expect.objectContaining({ calls: 2, costUsd: expect.closeTo(0.02, 9) })])
    log.mockRestore()
  })
})
