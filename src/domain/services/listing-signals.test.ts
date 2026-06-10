import { describe, it, expect } from 'vitest'
import { hasReplicaSignal } from './listing-signals'

describe('hasReplicaSignal', () => {
  it('flags "dans le style de <designer>"', () => {
    expect(hasReplicaSignal('Table basse dans le style de Willy Rizzo')).toBe(true)
  })

  it('flags "ressemble à <designer>"', () => {
    expect(hasReplicaSignal('Fauteuil qui ressemble à Michel Boyer')).toBe(true)
  })

  it('flags explicit "réplique" with or without accent', () => {
    expect(hasReplicaSignal('Réplique chaise Eames')).toBe(true)
    expect(hasReplicaSignal('replique chaise eames')).toBe(true)
  })

  it('flags "type <designer>" and "façon <designer>" and "d\'après"', () => {
    expect(hasReplicaSignal('Table type Willy Rizzo années 70')).toBe(true)
    expect(hasReplicaSignal('Buffet façon Knoll')).toBe(true)
    expect(hasReplicaSignal("Commode d'après un modèle ancien")).toBe(true)
  })

  it('does not flag a plain authentic description', () => {
    expect(hasReplicaSignal('Enfilade vintage en palissandre, signée Roche Bobois')).toBe(false)
  })

  it('is resilient to empty or missing text', () => {
    expect(hasReplicaSignal('')).toBe(false)
    expect(hasReplicaSignal(undefined)).toBe(false)
  })
})
