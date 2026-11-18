export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageMime = (typeof MEDIA_TYPES)[number]

export const wrongTypeMessage = 'only png, jpeg or webp images'
export const tooBigMessage = (maxBytes: number): string => `image larger than ${Math.round(maxBytes / 1048576)} MB`

export const checkImage = (file: { type: string; size: number }, maxBytes: number): string | null =>
  !(MEDIA_TYPES as readonly string[]).includes(file.type) ? wrongTypeMessage : file.size > maxBytes ? tooBigMessage(maxBytes) : null
