import { describe, expect, it, vi } from 'vitest'
import type { CompMatch } from '@/domain/services/ICompService'

vi.mock('./fetch-image', () => ({
  fetchImage: vi.fn(async (url: string) => {
    if (url.includes('broken')) throw new Error('Image download failed (404)')
    return { mimeType: 'image/jpeg', data: url }
  }),
}))

import { buildCompVerifyRequest, compCandidates, parseCompVerdicts } from './comp-verify-prompt'

const comp = (link: string, extra: Partial<CompMatch> = {}): CompMatch => ({ title: link, link, source: 'pamono', isValueDomain: true, ...extra })
const layout = (parts: Awaited<ReturnType<typeof buildCompVerifyRequest>>) =>
  parts.slice(1).map((p) => ('text' in p ? p.text : `img:${p.image.data}`))

describe('compCandidates', () => {
  it('keeps comps that have something to look at, at most 8', () => {
    const comps = [comp('none'), ...Array.from({ length: 9 }, (_, i) => comp(`c${i}`, { imageUrl: `https://t/${i}` }))]
    expect(compCandidates(comps).map((c) => c.link)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
  })
})

describe('buildCompVerifyRequest', () => {
  it('shows the ad photos, then each numbered candidate with its dealer photos, thumbnail as a fallback', async () => {
    const parts = await buildCompVerifyRequest({
      listingTitle: 'Table basse Alveo',
      listingImageUrls: ['https://ad/1', 'https://ad/2'],
      candidates: [comp('a', { imageUrl: 'https://t/a', photoUrls: ['https://p/a1', 'https://p/a2'] }), comp('b', { imageUrl: 'https://t/b' })],
    })
    expect('text' in parts[0] && parts[0].text).toMatch(/JSON/)
    expect(layout(parts)).toEqual([
      'Ad piece, titled "Table basse Alveo":', 'img:https://ad/1', 'img:https://ad/2',
      'Candidate 1', 'img:https://p/a1', 'img:https://p/a2',
      'Candidate 2', 'img:https://t/b',
    ])
  })

  it('drops a photo that fails to download but keeps the numbering', async () => {
    const parts = await buildCompVerifyRequest({
      listingTitle: 'T', listingImageUrls: ['https://ad/1', 'https://broken/ad'],
      candidates: [comp('a', { imageUrl: 'https://broken/a' }), comp('b', { imageUrl: 'https://t/b' })],
    })
    expect(layout(parts)).toEqual(['Ad piece, titled "T":', 'img:https://ad/1', 'Candidate 1 (photos unavailable)', 'Candidate 2', 'img:https://t/b'])
  })

  it('fails when no ad photo downloads, since there is nothing to compare against', async () => {
    await expect(buildCompVerifyRequest({ listingTitle: 'T', listingImageUrls: ['https://broken/ad'], candidates: [comp('a', { imageUrl: 'https://t/a' })] }))
      .rejects.toThrow(/No ad photo/)
  })
})

describe('parseCompVerdicts', () => {
  it('turns 1-based confirmed indices into one flag per candidate', () => {
    expect(parseCompVerdicts('{"confirmed": [1, 3]}', 4)).toEqual([true, false, true, false])
  })
  it('ignores indices out of range and non-numbers', () => {
    expect(parseCompVerdicts('{"confirmed": [0, 2, 9, "x"]}', 3)).toEqual([false, true, false])
  })
  it('confirms nothing on garbage, so a broken answer never inflates an estimate', () => {
    expect(parseCompVerdicts('no idea', 2)).toEqual([false, false])
    expect(parseCompVerdicts('{"confirmed": "all"}', 2)).toEqual([false, false])
  })
})
