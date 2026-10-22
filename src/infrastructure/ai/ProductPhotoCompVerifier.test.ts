import { describe, expect, it, vi } from 'vitest'
import type { CompMatch } from '@/domain/services/ICompService'
import type { ICompVerifier } from '@/domain/services/ICompVerifier'
import { ProductPhotoCompVerifier } from './ProductPhotoCompVerifier'

const comp = (link: string, imageUrl?: string): CompMatch => ({ title: link, link, source: 'chairish', isValueDomain: true, imageUrl })

describe('ProductPhotoCompVerifier', () => {
  it('hands the verifier each shown comp with its dealer photos and returns the caller\'s own objects', async () => {
    const comps = [comp('a', 'https://t/a'), comp('b', 'https://t/b'), comp('none')]
    const seen: CompMatch[][] = []
    const inner: ICompVerifier = { verify: async ({ comps }) => { seen.push(comps); return comps.filter((c) => c.link === 'b') } }
    const fetchPhotos = vi.fn(async (link: string, max: number) => Array.from({ length: max }, (_, i) => `https://p/${link}/${i}`))

    vi.spyOn(console, 'log').mockImplementation(() => {})
    const kept = await new ProductPhotoCompVerifier(inner, 2, fetchPhotos).verify({ listingImageUrls: ['https://ad'], listingTitle: 'T', comps })

    expect(kept).toEqual([comps[1]])
    expect(kept[0]).toBe(comps[1])
    expect(seen[0].map((c) => c.photoUrls)).toEqual([['https://p/a/0', 'https://p/a/1'], ['https://p/b/0', 'https://p/b/1'], undefined])
    expect(fetchPhotos).toHaveBeenCalledTimes(2)
  })
})
