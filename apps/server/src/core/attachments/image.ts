export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]

export const ATTACHMENT_KINDS = ['mockup', 'screenshot', 'before', 'after'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const RUN_IMAGE_MAX = 12
export const RECORD_IMAGE_MAX = 30
export const UPLOAD_TTL_MS = 10 * 60_000

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

const startsWith = (bytes: Uint8Array, magic: number[], at = 0): boolean =>
  magic.every((byte, index) => bytes[at + index] === byte)

export const imageTypeOf = (bytes: Uint8Array): ImageType | null => {
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp'
  return null
}

export class UploadRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}
