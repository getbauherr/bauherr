import { expect, it } from 'vitest'
import { checkImage, MEDIA_TYPES, tooBigMessage, wrongTypeMessage } from '../src/lib/intake/media-check'

const max = 5 * 1024 * 1024

it('accepts png, jpeg and webp up to the limit', () => {
  for (const type of MEDIA_TYPES) expect(checkImage({ type, size: max }, max)).toBeNull()
})

it('rejects other types and oversize files with the server messages', () => {
  expect(checkImage({ type: 'image/svg+xml', size: 1 }, max)).toBe(wrongTypeMessage)
  expect(checkImage({ type: '', size: 1 }, max)).toBe(wrongTypeMessage)
  expect(checkImage({ type: 'image/png', size: max + 1 }, max)).toBe(tooBigMessage(max))
  expect(tooBigMessage(max)).toBe('image larger than 5 MB')
})
