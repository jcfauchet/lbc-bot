import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchImage, imageDimensions, IMAGE_FETCH_TIMEOUT_MS } from './fetch-image'

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

  it('refuses a photo larger than a model accepts, and passes one it can read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(png(4000, 2000)))))
    await expect(fetchImage('https://img/big.png')).rejects.toThrow('Image too large (4000x2000)')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(png(1600, 1200)))))
    expect((await fetchImage('https://img/ok.png')).mimeType).toBe('image/png')
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

const png = (width: number, height: number) => {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

describe('imageDimensions', () => {
  it('reads PNG, GIF, JPEG and the three WebP headers', () => {
    expect(imageDimensions(png(800, 600))).toEqual({ width: 800, height: 600 })

    const gif = Buffer.alloc(10)
    gif.write('GIF89a')
    gif.writeUInt16LE(320, 6)
    gif.writeUInt16LE(240, 8)
    expect(imageDimensions(gif)).toEqual({ width: 320, height: 240 })

    // SOI, an APP0 segment of 4 bytes, then SOF0 holding 3024 x 4032.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xc0, 0x0b, 0xd0, 0x03, 0, 0, 0])
    expect(imageDimensions(jpeg)).toEqual({ width: 3024, height: 4032 })

    const webp = (chunk: string, fill: (b: Buffer) => void) => {
      const b = Buffer.alloc(30)
      b.write('RIFF')
      b.write('WEBP', 8)
      b.write(chunk, 12)
      fill(b)
      return b
    }
    expect(imageDimensions(webp('VP8 ', (b) => { b.writeUInt16LE(1200, 26); b.writeUInt16LE(900, 28) }))).toEqual({ width: 1200, height: 900 })
    expect(imageDimensions(webp('VP8L', (b) => b.writeUInt32LE((1199) | (899 << 14), 21)))).toEqual({ width: 1200, height: 900 })
    expect(imageDimensions(webp('VP8X', (b) => { b.writeUIntLE(3999, 24, 3); b.writeUIntLE(2999, 27, 3) }))).toEqual({ width: 4000, height: 3000 })
  })

  it('returns null for a header it does not know', () => {
    expect(imageDimensions(Buffer.from([1, 2, 3]))).toBeNull()
  })
})
