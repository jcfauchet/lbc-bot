import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const listAuctionLots = vi.fn()
vi.mock('@/infrastructure/di/container', () => ({
  container: { referenceRepository: { listAuctionLots: (...args: unknown[]) => listAuctionLots(...args) } },
}))
vi.mock('@/infrastructure/config/env', () => ({ env: { REFERENCES_KEY: 'test-references-key-123' } }))

import { GET } from './route'

const request = (query: string) => new NextRequest(`http://localhost/api/references/fund/lots${query}`)

describe('GET /api/references/fund/lots', () => {
  beforeEach(() => {
    listAuctionLots.mockReset()
    listAuctionLots.mockResolvedValue({ total: 100, lots: [] })
  })

  it('rejects a request without the right key', async () => {
    expect((await GET(request(''))).status).toBe(401)
    expect(listAuctionLots).not.toHaveBeenCalled()
  })

  it('passes house, category, text and the page offset to the repository', async () => {
    const res = await GET(request('?k=test-references-key-123&house=OSENAT&category=FURNITURE&q=prouv%C3%A9&page=3'))
    expect(res.status).toBe(200)
    expect(listAuctionLots).toHaveBeenCalledWith({ house: 'OSENAT', category: 'FURNITURE', search: 'prouvé', offset: 96, limit: 48 })
    expect(await res.json()).toEqual({ total: 100, page: 3, pageSize: 48, lots: [] })
  })

  it('ignores unknown filters and a bad page number', async () => {
    await GET(request('?k=test-references-key-123&house=toString&category=PAINTINGS&page=-4'))
    expect(listAuctionLots).toHaveBeenCalledWith({ house: undefined, category: undefined, search: undefined, offset: 0, limit: 48 })
  })
})
