import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'

// Mock the ranking-prompt module
vi.mock('../ranking-prompt', () => ({
  buildRankingPrompt: (guidance?: string | null) => `prompt-with-guidance-${guidance ?? 'none'}`,
  renderCandidateList: (candidates: RankingCandidate[]) => {
    return candidates.map((c, i) => `Candidate ${i + 1}: ${c.title}`).join('\n')
  },
  parseRanking: (raw: string, candidates: RankingCandidate[]): RankedPick[] | null => {
    if (raw === 'unparseable') return null
    if (raw === 'empty') return []
    // Mock real parseRanking behavior
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }

    const picks = (parsed as { picks?: unknown })?.picks
    if (!Array.isArray(picks)) return null

    const ranked: RankedPick[] = []
    for (const entry of picks) {
      if (typeof entry !== 'object' || entry === null) continue
      const { candidate, worthCredit, reason } = entry as Record<string, unknown>
      if (!Number.isInteger(candidate)) continue
      const match = candidates[(candidate as number) - 1]
      if (!match) continue
      ranked.push({
        listingId: match.listingId,
        rank: ranked.length + 1,
        worthCredit: worthCredit !== false,
        reason: typeof reason === 'string' ? reason : undefined,
      })
    }
    return ranked
  },
}))

// Mock the GoogleGenAI module with a constructor mock
const mockGenerateContent = vi.fn()
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: any) {
    this.models = { generateContent: mockGenerateContent }
    return this
  }),
}))

describe('GeminiSelectionRanker', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as any
    mockGenerateContent.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops a candidate with HTTP 404, ranks others, preserves numbering', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
      { listingId: 'B', imageUrl: 'http://b.jpg', title: 'B', priceEur: 200 },
      { listingId: 'C', imageUrl: 'http://c.jpg', title: 'C', priceEur: 300 },
    ]

    // A succeeds, B returns 404 with distinguishable bytes, C succeeds
    // Pre-fix: 404 bytes would still be encoded and B kept; post-fix: B dropped
    fetchMock
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })
      .mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(5) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: '{"picks": [{"candidate": 2}]}',
    })

    const ranker = new GeminiSelectionRanker('test-key')
    const picks = await ranker.rank(candidates)

    // Model sees only A (as 1) and C (as 2), picks candidate 2 which should resolve to C
    expect(picks).toHaveLength(1)
    expect(picks[0].listingId).toBe('C')
    expect(picks[0].rank).toBe(1)
  })

  it('drops a candidate whose fetch rejects, ranks others with consistent numbering', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'X', imageUrl: 'http://x.jpg', title: 'X', priceEur: 100 },
      { listingId: 'Y', imageUrl: 'http://y.jpg', title: 'Y', priceEur: 200 },
      { listingId: 'Z', imageUrl: 'http://z.jpg', title: 'Z', priceEur: 300 },
    ]

    // X succeeds, Y rejects, Z succeeds
    fetchMock
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: '{"picks": [{"candidate": 1}]}',
    })

    const ranker = new GeminiSelectionRanker('test-key')
    const picks = await ranker.rank(candidates)

    // Model sees only X (as 1) and Z (as 2), picks candidate 1 which should resolve to X
    expect(picks).toHaveLength(1)
    expect(picks[0].listingId).toBe('X')
  })

  it('throws when all candidate images fail to fetch', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
      { listingId: 'B', imageUrl: 'http://b.jpg', title: 'B', priceEur: 200 },
    ]

    // Both fail
    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: false })

    const ranker = new GeminiSelectionRanker('test-key')
    await expect(ranker.rank(candidates)).rejects.toThrow('All candidate images failed to fetch')
  })

  it('throws when model response cannot be parsed', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
    ]

    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: 'unparseable',
    })

    const ranker = new GeminiSelectionRanker('test-key')
    await expect(ranker.rank(candidates)).rejects.toThrow('Ranking response could not be parsed')
  })

  it('returns empty array when model validly chooses no picks', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
    ]

    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: 'empty',
    })

    const ranker = new GeminiSelectionRanker('test-key')
    const picks = await ranker.rank(candidates)
    expect(picks).toEqual([])
  })

  it('passes guidance to the prompt builder', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
    ]

    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: 'empty',
    })

    const ranker = new GeminiSelectionRanker('test-key')
    await ranker.rank(candidates, 'test guidance')

    // Verify generateContent was called
    expect(mockGenerateContent).toHaveBeenCalled()
    const callArgs = mockGenerateContent.mock.calls[0][0]
    const firstContent = (callArgs.contents as any)[0]
    expect(firstContent.text).toContain('test guidance')
  })

  it('handles model returning response.text as undefined', async () => {
    const { GeminiSelectionRanker } = await import('./GeminiSelectionRanker')
    const candidates: RankingCandidate[] = [
      { listingId: 'A', imageUrl: 'http://a.jpg', title: 'A', priceEur: 100 },
    ]

    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })

    mockGenerateContent.mockResolvedValueOnce({
      text: undefined,
    })

    const ranker = new GeminiSelectionRanker('test-key')
    // Should handle undefined text (becomes '' after ?? operator), which parseRanking will return null for
    await expect(ranker.rank(candidates)).rejects.toThrow('Ranking response could not be parsed')
  })
})
