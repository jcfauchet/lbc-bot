import { describe, it, expect } from 'vitest'
import { EmailTemplates } from './EmailTemplates'
import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'
import type { AuctionLotSummary, PendingAlert } from '@/domain/repositories/IReferenceRepository'

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

const alertWithAuction = (lot: Partial<AuctionLotSummary> = {}, overrides: Partial<PendingAlert> = {}): PendingAlert => ({
  matchId: 'm1', referenceName: 'Chaise pliante Plia', referenceImageUrl: 'https://ref/plia.jpg', listingId: 'l1',
  listingTitle: 'Chaise pliante Plia', listingUrl: 'https://lbc/l1', priceCents: 12000, city: 'Lyon',
  listingImageUrl: 'https://img/l1.jpg', reason: 'same chrome frame', source: 'AUCTION', similarity: 0.82,
  auction: {
    house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '415-a', lotUrl: 'https://www.artcurial.com/ventes/IT6064/lots/415-a',
    saleName: 'Design italien', soldAt: new Date('2025-03-07T00:00:00Z'), title: 'Chaise pliante Plia', artist: 'Giancarlo Piretti',
    hammerCents: 17000, quantity: 1, hammerPerUnitCents: 17000, ...lot,
  },
  ...overrides,
})

describe('EmailTemplates.auctionMatch', () => {
  it('auctionMatch shows the ad price, the hammer price and the per-unit price when the lot is a set', () => {
    const { subject, html } = EmailTemplates.auctionMatch([alertWithAuction({ hammerCents: 170000, quantity: 10, hammerPerUnitCents: 17000 })])
    expect(subject).toBe('🔨 Vu chez Artcurial à 1700 € : Chaise pliante Plia')
    expect(html).toContain('120 €')
    expect(html).toContain('170 €')
    expect(html).toContain('la pièce')
    expect(html).toContain('lot de 10')
    expect(html).toContain('https://www.artcurial.com/ventes/IT6064/lots/415-a')
  })

  it('shows the artist first, the sale date and the reason, without a per-unit line for a single piece', () => {
    const { html } = EmailTemplates.auctionMatch([alertWithAuction()])
    expect(html).toContain('Giancarlo Piretti, Chaise pliante Plia')
    expect(html).toContain('Adjugé 170 € le 07/03/2025')
    expect(html).toContain('Design italien')
    expect(html).toContain('same chrome frame')
    expect(html).not.toContain('la pièce')
  })

  it('lists every lot in the given order and takes the subject price from the first', () => {
    const { subject, html } = EmailTemplates.auctionMatch([
      alertWithAuction({ lotRef: '2', lotUrl: 'https://lot/2', hammerCents: 50000 }, { matchId: 'm2' }),
      alertWithAuction({ lotRef: '1', lotUrl: 'https://lot/1', hammerCents: 30000 }),
    ])
    expect(subject).toBe('🔨 Vu chez Artcurial à 500 € : Chaise pliante Plia')
    expect(html.indexOf('https://lot/2')).toBeLessThan(html.indexOf('https://lot/1'))
  })

  it('names the auction house of the best lot in the title, the photo caption and the subject', () => {
    const rossini = EmailTemplates.auctionMatch([alertWithAuction({ house: 'ROSSINI' })])
    expect(rossini.subject.startsWith('🔨 Vu chez Rossini à')).toBe(true)
    expect(rossini.html).toContain('🔨 Vu chez Rossini')
    expect(rossini.html).toContain('Lot Rossini')
    expect(rossini.html).not.toContain('Artcurial')
    const artcurial = EmailTemplates.auctionMatch([alertWithAuction({ house: 'ARTCURIAL' })])
    expect(artcurial.subject).toBe('🔨 Vu chez Artcurial à 170 € : Chaise pliante Plia')
    expect(artcurial.html).toContain('🔨 Vu chez Artcurial')
    expect(artcurial.html).toContain('Lot Artcurial')
  })

  it('falls back to the raw house code for a house without a label', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other = EmailTemplates.auctionMatch([alertWithAuction({ house: 'OTHER' as any })])
    expect(other.subject.startsWith('🔨 Vu chez OTHER à')).toBe(true)
    expect(other.html).toContain('🔨 Vu chez OTHER')
  })
})

describe('EmailTemplates match emails escape scraped text', () => {
  const hostile = alertWithAuction(
    { title: 'Lot <i>x</i>', artist: 'A "B"', saleName: "Vente l'été <script>", lotUrl: 'https://lot/1?a=1&b=2' },
    {
      listingTitle: 'Chaise <b>Plia</b> & co', city: '<Lyon>', reason: 'same <frame>', referenceName: 'Ref <u>1</u>',
      listingUrl: 'https://lbc/l1?a=1&b="2"', listingImageUrl: 'https://img/l1.jpg?w=1&h=2',
    },
  )
  const escapedTitle = 'Chaise &lt;b&gt;Plia&lt;/b&gt; &amp; co'

  it('escapes every text slot of the auction email and keeps URLs with & working', () => {
    const { subject, html } = EmailTemplates.auctionMatch([hostile])
    expect(html).toContain(escapedTitle)
    expect(html).not.toContain('<b>Plia</b>')
    expect(html).toContain('&lt;Lyon&gt;')
    expect(html).toContain('same &lt;frame&gt;')
    expect(html).toContain('A &quot;B&quot;, Lot &lt;i&gt;x&lt;/i&gt;')
    expect(html).toContain('Vente l&#39;été &lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="https://lot/1?a=1&amp;b=2"')
    expect(html).toContain('href="https://lbc/l1?a=1&amp;b=&quot;2&quot;"')
    expect(html).toContain('src="https://img/l1.jpg?w=1&amp;h=2"')
    // The subject is plain text, not HTML.
    expect(subject).toContain('Chaise <b>Plia</b> & co')
  })

  it('escapes every text slot of the manual reference email', () => {
    const { html } = EmailTemplates.referenceMatch({ ...hostile, source: 'MANUAL', auction: null })
    expect(html).toContain(escapedTitle)
    expect(html).not.toContain('<b>Plia</b>')
    expect(html).toContain('Ref &lt;u&gt;1&lt;/u&gt;')
    expect(html).toContain('same &lt;frame&gt;')
    expect(html).toContain('href="https://lbc/l1?a=1&amp;b=&quot;2&quot;"')
  })
})
