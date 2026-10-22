/**
 * Two implementations of the same AI port behind one object: each method call
 * goes to the primary, and any error (outage, refusal, monthly spend limit hit)
 * replays the same call on the fallback.
 */
export function withFallback<T extends object>(primary: T, fallback: T, label: string): T {
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args)
        } catch (err) {
          console.warn(`${label} primary failed, falling back:`, err)
          const alternative = Reflect.get(fallback, prop) as (...a: unknown[]) => unknown
          return alternative.apply(fallback, args)
        }
      }
    },
  })
}
