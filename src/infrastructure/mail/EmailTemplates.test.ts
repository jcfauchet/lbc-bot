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
