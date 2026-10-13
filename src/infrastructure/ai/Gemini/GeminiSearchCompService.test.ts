import { beforeEach, describe, expect, it, vi } from 'vitest'

type Request = { model: string; contents: unknown; config?: { tools?: unknown[] } }
const generateContent = vi.fn(async (_request: Request) => ({
  text: '{"comps":[{"title":"Alveo","link":"https://www.selency.fr/x","priceEur":1200}]}',
}))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent } } }))
vi.mock('../fetch-image', () => ({ fetchImage: vi.fn(async () => ({ mimeType: 'image/jpeg', data: 'AAAA' })) }))

import { GeminiSearchCompService } from './GeminiSearchCompService'

describe('GeminiSearchCompService', () => {
  beforeEach(() => generateContent.mockClear())

  it('asks gemini-3.6-flash with Google Search enabled, the photo and the ad text', async () => {
    const svc = new GeminiSearchCompService('key')
    const { matches } = await svc.findComps('https://img/x.jpg', { title: 'Table Willy Rizzo', description: 'Alveo', priceEur: 350 })
    const call = generateContent.mock.calls[0][0]
    expect(call.model).toBe('gemini-3.6-flash')
    expect(call.config?.tools).toEqual([{ googleSearch: {} }])
    expect(JSON.stringify(call.contents)).toContain('Table Willy Rizzo')
    expect(JSON.stringify(call.contents)).toContain('"data":"AAAA"')
    expect(matches[0]).toMatchObject({ title: 'Alveo', isValueDomain: true, price: { value: 1200, currency: 'EUR' } })
  })

  it('names its provider so analyses record where the estimate came from', () => {
    expect(new GeminiSearchCompService('key').providerName).toBe('gemini-google-search')
  })

  it('still works from the photo alone when the caller has no ad text', async () => {
    await new GeminiSearchCompService('key').findComps('https://img/x.jpg')
    expect(generateContent).toHaveBeenCalledOnce()
  })
})
