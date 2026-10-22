import { describe, expect, it } from 'vitest'
import type { CompMatch } from '@/domain/services/ICompService'
import type { ICompVerifier } from '@/domain/services/ICompVerifier'
import { ConsensusCompVerifier } from './ConsensusCompVerifier'

const comp = (link: string): CompMatch => ({ title: link, link, source: 'pamono', isValueDomain: true, imageUrl: `https://t/${link}` })
const comps = [comp('a'), comp('b'), comp('c')]
const input = { listingImageUrls: ['https://img/1'], listingTitle: 'Table', comps }
const confirming = (...links: string[]): ICompVerifier => ({ verify: async ({ comps }) => comps.filter((c) => links.includes(c.link)) })
const failing: ICompVerifier = { verify: async () => { throw new Error('429 spend limit') } }

describe('ConsensusCompVerifier', () => {
  it('confirms only the comparables both verifiers confirm', async () => {
    const kept = await new ConsensusCompVerifier(confirming('a', 'b'), confirming('b', 'c')).verify(input)
    expect(kept.map((c) => c.link)).toEqual(['b'])
  })

  it('fails when one verifier fails, so one model never vouches alone', async () => {
    await expect(new ConsensusCompVerifier(confirming('a'), failing).verify(input)).rejects.toThrow('spend limit')
    await expect(new ConsensusCompVerifier(failing, confirming('a')).verify(input)).rejects.toThrow('spend limit')
  })
})
