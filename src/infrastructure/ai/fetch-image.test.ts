import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchImage, IMAGE_FETCH_TIMEOUT_MS } from './fetch-image'

afterEach(() => vi.unstubAllGlobals())

describe('fetchImage', () => {
  it('returns base64 data and the mime type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png; charset=binary' } })))
    expect(await fetchImage('https://img/x.png')).toEqual({ mimeType: 'image/png', data: Buffer.from([1, 2]).toString('base64') })
  })

  it('defaults to jpeg when the CDN sends no content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))))
    expect((await fetchImage('https://img/x')).mimeType).toBe('image/jpeg')
  })

  it('bounds the download so a stalled CDN cannot hold the stage', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1])))
    vi.stubGlobal('fetch', fetchMock)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await fetchImage('https://img/x.jpg')
    expect(timeout).toHaveBeenCalledWith(IMAGE_FETCH_TIMEOUT_MS)
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) })
  })

  it('throws on a non-2xx download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })))
    await expect(fetchImage('https://img/gone.jpg')).rejects.toThrow('Image download failed (404)')
  })
})
