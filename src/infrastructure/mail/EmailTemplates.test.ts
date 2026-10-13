import { describe, it, expect } from 'vitest'
import { EmailTemplates } from './EmailTemplates'
import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const deal = (bestMatchSource?: string) => ({
  listing: Listing.create({ lbcId: '1', searchId: 's', url: 'https://lbc/1', title: 'Desserte laiton', price: Money.fromEuros(120), status: ListingStatus.ANALYZED }),
  analysis: AiAnalysis.create({
    listingId: 'l1', estimatedMinPrice: Money.fromEuros(400), estimatedMaxPrice: Money.fromEuros(600),
    margin: Money.fromEuros(280), description: 'brass trolley', provider: 'serpapi', bestMatchSource,
  }),
})

describe('EmailTemplates.goodDealsDigest', () => {
  it('shows the estimate once', () => {
    const html = EmailTemplates.goodDealsDigest([deal()])
    expect(html.split(Money.fromEuros(400).toString()).length - 1).toBe(1)
    expect(html).not.toContain('Estimation:')
  })

  it('links the comparable with its site name instead of printing the raw URL', () => {
    const url = 'https://www.chairish.com/product/123/brass-trolley'
    const html = EmailTemplates.goodDealsDigest([deal(url)])
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('chairish.com')
    expect(html).not.toContain(`</strong> ${url}`)
  })

  it('keeps a non-URL source as plain text', () => {
    expect(EmailTemplates.goodDealsDigest([deal('Selency')])).toContain('Selency')
  })
})

describe('EmailTemplates.goodDealsDigest comp check badge', () => {
  const withCheck = (compCheck: any) => {
    const d = deal()
    d.analysis = AiAnalysis.create({
      listingId: 'l1', estimatedMinPrice: Money.fromEuros(400), estimatedMaxPrice: Money.fromEuros(600),
      margin: Money.fromEuros(280), description: 'brass trolley', provider: 'serpapi', compCheck,
    })
    return d
  }
  const candidate = (link: string, confirmed: boolean) => ({ title: 't', link, source: 'selency.fr', priceEur: 500, confirmed })

  it('says how many comparables were confirmed and links them', () => {
    const html = EmailTemplates.goodDealsDigest([withCheck({
      confirmedCount: 2,
      candidates: [candidate('https://www.selency.fr/a', true), candidate('https://www.pamono.fr/b', false), candidate('https://www.1stdibs.com/c', true)],
    })])
    expect(html).toContain('2 comparables confirmés sur 3')
    expect(html).toContain('href="https://www.selency.fr/a"')
    expect(html).toContain('href="https://www.1stdibs.com/c"')
    expect(html).not.toContain('href="https://www.pamono.fr/b"')
  })

  it('warns when none of the comparables is the same piece', () => {
    const html = EmailTemplates.goodDealsDigest([withCheck({ confirmedCount: 0, candidates: [candidate('https://www.selency.fr/a', false)] })])
    expect(html).toContain('Aucun comparable confirmé sur 1')
    expect(html).toContain('ressemblances')
  })

  it('shows nothing about verification when the analysis was not checked', () => {
    expect(EmailTemplates.goodDealsDigest([deal()])).not.toContain('comparable confirmé')
  })
})
