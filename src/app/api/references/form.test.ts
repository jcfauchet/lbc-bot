import { describe, it, expect } from 'vitest'
import { parseMaxPriceCents, parseReferenceForm, MAX_TOTAL_UPLOAD_BYTES } from './form'

const jpeg = (size = 300_000) => ({ size, type: 'image/jpeg' })

describe('parseMaxPriceCents', () => {
  it.each([
    ['150', 15000], ['150 €', 15000], ['150€', 15000], ['1 200', 120000], ['1 200 €', 120000], ['150,50', 15050], ['150.5', 15050],
  ])('parses %s', (raw, cents) => expect(parseMaxPriceCents(raw)).toBe(cents))
  it('is null when blank', () => expect(parseMaxPriceCents('  ')).toBeNull())
  it('flags garbage and non-positive values', () => {
    expect(parseMaxPriceCents('abc')).toBe('invalid')
    expect(parseMaxPriceCents('0')).toBe('invalid')
    expect(parseMaxPriceCents('-5')).toBe('invalid')
  })
})

describe('parseReferenceForm', () => {
  const base = { name: ' Desserte Jansen ', maxPrice: '150 €', note: '', images: [jpeg()] }

  it('accepts a valid form and trims', () => {
    expect(parseReferenceForm(base)).toEqual({ ok: true, value: { name: 'Desserte Jansen', note: null, maxPriceCents: 15000 } })
  })
  it('requires a name', () => {
    expect(parseReferenceForm({ ...base, name: '  ' })).toMatchObject({ ok: false, status: 400 })
  })
  it('requires 1 to 5 images', () => {
    expect(parseReferenceForm({ ...base, images: [] })).toMatchObject({ ok: false, status: 400 })
    expect(parseReferenceForm({ ...base, images: Array.from({ length: 6 }, () => jpeg()) })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects non-image files', () => {
    expect(parseReferenceForm({ ...base, images: [{ size: 10, type: 'application/pdf' }] })).toMatchObject({ ok: false, status: 400 })
  })
  it('rejects an unreadable max price with a message', () => {
    expect(parseReferenceForm({ ...base, maxPrice: 'abc' })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('prix') })
  })
  it('answers 413 with a readable message when photos are too heavy', () => {
    const res = parseReferenceForm({ ...base, images: [jpeg(MAX_TOTAL_UPLOAD_BYTES + 1)] })
    expect(res).toMatchObject({ ok: false, status: 413, error: expect.stringContaining('lourdes') })
  })
})
