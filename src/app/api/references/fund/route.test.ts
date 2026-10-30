import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/di/container', () => ({
  container: {
    referenceRepository: {
      auctionFundStats: async () => ({
        lots: 311, images: 740, embedded: 740,
        byHouse: [{ house: 'ARTCURIAL', lots: 300 }, { house: 'ROSSINI', lots: 11 }],
      }),
    },
  },
}))
vi.mock('@/infrastructure/config/env', () => ({
  env: { REFERENCES_KEY: 'test-references-key-123', AUCTION_REFERENCES_ENABLED: true },
}))

import { GET } from './route'

const request = (query = '') => new NextRequest(`http://localhost/api/references/fund${query}`)

describe('GET /api/references/fund', () => {
  it('rejects a request without the key', async () => {
    const res = await GET(request())
    expect(res.status).toBe(401)
  })

  it('rejects a wrong key', async () => {
    const res = await GET(request('?k=wrong-key-wrong-key'))
    expect(res.status).toBe(401)
  })

  it('returns the fund size per house and the switch with the right key', async () => {
    const res = await GET(request('?k=test-references-key-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      lots: 311, images: 740, embedded: 740, enabled: true,
      byHouse: [{ house: 'ARTCURIAL', lots: 300 }, { house: 'ROSSINI', lots: 11 }],
    })
  })
})
