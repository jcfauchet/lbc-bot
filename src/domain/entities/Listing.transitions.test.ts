import { describe, it, expect } from 'vitest'
import { Listing } from './Listing'
import { ListingStatus } from '../value-objects/ListingStatus'
import { Money } from '../value-objects/Money'

function make(): Listing {
  return Listing.create({
    lbcId: 'x', searchId: 's', url: 'u', title: 't',
    price: Money.fromEuros(50), status: ListingStatus.NEW,
  })
}

describe('Listing funnel transitions', () => {
  it('marks as prefiltered', () => {
    const l = make()
    l.markAsPrefiltered()
    expect(l.status).toBe(ListingStatus.PREFILTERED)
  })

  it('marks as triaged and stores the score', () => {
    const l = make()
    l.markAsTriaged(7)
    expect(l.status).toBe(ListingStatus.TRIAGED)
    expect(l.triageScore).toBe(7)
  })
})
