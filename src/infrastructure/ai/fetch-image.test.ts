import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchImage, IMAGE_FETCH_TIMEOUT_MS } from './fetch-image'

afterEach(() => vi.unstubAllGlobals())

describe('fetchImage', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])

  it('reads the format from the bytes when the CDN mislabels it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(WEBP, { headers: { 'content-type': 'binary/octet-stream' } })))
    expect((await fetchImage('https://img/x')).mimeType).toBe('image/webp')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JPEG, { headers: { 'content-type': 'image/png' } })))
    expect((await fetchImage('https://img/x')).mimeType).toBe('image/jpeg')
  })

  it('refuses a format the models cannot read, such as AVIF, instead of sinking the whole request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 0x1c]), { headers: { 'content-type': 'image/avif' } })))
    await expect(fetchImage('https://img/x.avif')).rejects.toThrow('Unsupported image format (image/avif)')
  })

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
