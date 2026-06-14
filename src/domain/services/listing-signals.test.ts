import { describe, it, expect } from 'vitest'
import { hasReplicaSignal, hasKnownDesignerAttribution } from './listing-signals'

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

describe('hasKnownDesignerAttribution', () => {
  it('flags a known editor/brand named in the listing', () => {
    expect(hasKnownDesignerAttribution('Table Kartell Anna Castelli')).toBe(true)
    expect(hasKnownDesignerAttribution('Table basse Michel Dumas Roche Bobois')).toBe(true)
    expect(hasKnownDesignerAttribution('Table Basse Cone Verner Panton - Édition Vitra')).toBe(true)
  })

  it('flags a known designer named in the listing', () => {
    expect(hasKnownDesignerAttribution('Paire de Trolley Boby design Joe Colombo Ed. Bieffeplast')).toBe(true)
    expect(hasKnownDesignerAttribution('Fauteuil Alky par Giancarlo Piretti 1970')).toBe(true)
  })

  it('flags explicit attribution verbs followed by a name', () => {
    expect(hasKnownDesignerAttribution('Très belle table en pierre de lave signée Barrois')).toBe(true)
    expect(hasKnownDesignerAttribution('Commode estampillée Jansen')).toBe(true)
  })

  it('does not flag a hidden gem with no attribution', () => {
    expect(hasKnownDesignerAttribution('Belle enfilade vintage en palissandre à restaurer')).toBe(false)
    expect(hasKnownDesignerAttribution('Table basse vintage')).toBe(false)
  })

  it('does not flag an explicitly unsigned piece', () => {
    expect(hasKnownDesignerAttribution('Jolie commode des années 70, non signée')).toBe(false)
  })

  it('is resilient to empty or missing text', () => {
    expect(hasKnownDesignerAttribution('')).toBe(false)
    expect(hasKnownDesignerAttribution(undefined)).toBe(false)
  })
})
