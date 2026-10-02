import { MAX_IMAGES } from '@/app/api/references/form'

export const MAX_PHOTOS = MAX_IMAGES

/** Picks add up across several taps (gallery, then camera), capped at the API limit. */
export function addPhotos<T>(current: T[], picked: T[]): T[] {
  return [...current, ...picked].slice(0, MAX_PHOTOS)
}

export function removePhoto<T>(current: T[], index: number): T[] {
  return current.filter((_, i) => i !== index)
}
