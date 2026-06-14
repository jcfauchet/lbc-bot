import { describe, it, expect, vi, afterEach } from 'vitest'
import { withErrorHandling, handleError, AppError } from './ErrorHandler'

afterEach(() => vi.restoreAllMocks())

describe('error handling', () => {
  it('never kills the process on a plain error (serverless-safe)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    handleError(new Error('boom'), 'TEST')

    expect(exit).not.toHaveBeenCalled()
  })

  it('never kills the process on a non-operational AppError', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    handleError(new AppError('fatal', 'X', 500, false), 'TEST')

    expect(exit).not.toHaveBeenCalled()
  })

  it('rethrows so the caller (route) can return a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      withErrorHandling(async () => { throw new Error('downstream') }, 'TEST'),
    ).rejects.toThrow('downstream')
  })
})
