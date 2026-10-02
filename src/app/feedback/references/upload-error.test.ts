import { describe, it, expect } from 'vitest'
import { uploadErrorMessage, isUploadTooHeavy } from './upload-error'
import { MAX_TOTAL_UPLOAD_BYTES } from '@/app/api/references/form'

describe('uploadErrorMessage', () => {
  it('uses the server message when there is one', () => {
    expect(uploadErrorMessage(400, { error: 'Donne un nom à la référence.' })).toBe('Donne un nom à la référence.')
  })
  it('explains a 413, including the platform one that has no JSON body', () => {
    expect(uploadErrorMessage(413, {})).toContain('lourdes')
  })
  it('falls back to a generic message', () => {
    expect(uploadErrorMessage(504, {})).toBe('Erreur, réessaie.')
  })
})

describe('isUploadTooHeavy', () => {
  it('flags photos that would exceed the upload limit before sending them', () => {
    expect(isUploadTooHeavy([{ size: MAX_TOTAL_UPLOAD_BYTES }, { size: 1 }])).toBe(true)
    expect(isUploadTooHeavy([{ size: 300_000 }, { size: 300_000 }])).toBe(false)
  })
})
