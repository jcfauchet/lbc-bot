import { describe, expect, it } from 'vitest'
import { HOUSE_LABELS, HOUSE_SLUGS } from '@/domain/auction-houses'
import type { IReferenceRepository } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import { buildAuctionIngesters } from './auction-ingesters'

describe('buildAuctionIngesters', () => {
  const ingesters = buildAuctionIngesters({
    fetcher: { fetchText: async () => '' },
    repo: {} as IReferenceRepository,
    embedder: {} as IImageEmbeddingService,
    log: () => {},
  })

  it.each(Object.entries(HOUSE_SLUGS))('slug %s maps to a labelled house with an ingester', (_slug, house) => {
    expect(HOUSE_LABELS[house]).toBeTruthy()
    expect(ingesters[house]).toBeDefined()
  })

  it('has a slug for every house with an ingester', () => {
    expect(new Set(Object.values(HOUSE_SLUGS))).toEqual(new Set(Object.keys(ingesters)))
  })

  it('wires Ader', () => {
    expect(HOUSE_SLUGS.ader).toBe('ADER')
  })
})
