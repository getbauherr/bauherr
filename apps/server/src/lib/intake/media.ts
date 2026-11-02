export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES_PER_SESSION = 5

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

const ascii = (b: Uint8Array, at: number, s: string): boolean => [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

/** The image type by magic bytes; the client's Content-Type is never trusted. */
export const sniff = (b: Uint8Array): ImageMime | null =>
  b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b[0] === 0x89 && ascii(b, 1, 'PNG\r\n') && b[6] === 0x1a && b[7] === 0x0a ? 'image/png'
  : ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') ? 'image/webp'
  : null

const u32 = (b: Uint8Array, at: number, le = false): number => new DataView(b.buffer, b.byteOffset).getUint32(at, le)
const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

/** Drops EXIF, XMP and text metadata (location, device, author) without re-encoding; throws on a truncated file. */
export const stripMetadata = (b: Uint8Array, mime: ImageMime): Uint8Array => {
  const parts: Uint8Array[] = []
  const bad = () => new Error('corrupt image')
  if (mime === 'image/jpeg') {
    parts.push(b.subarray(0, 2))
    let at = 2
    while (at < b.length) {
      if (b[at] !== 0xff) throw bad()
      while (b[at + 1] === 0xff) at++
      const marker = b[at + 1]!
      if (marker === 0xda) return join([...parts, b.subarray(at)])
      const end = at + 2 + ((b[at + 2]! << 8) | b[at + 3]!)
      if (end > b.length) throw bad()
      if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(b.subarray(at, end))
      at = end
    }
    throw bad()
  }
  if (mime === 'image/png') {
    parts.push(b.subarray(0, 8))
    for (let at = 8; at < b.length; ) {
      const end = at + 12 + u32(b, at)
      if (end > b.length) throw bad()
      if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].some((t) => ascii(b, at + 4, t))) parts.push(b.subarray(at, end))
      at = end
    }
    return join(parts)
  }
  for (let at = 12; at < b.length; ) {
    const size = u32(b, at + 4, true)
    const end = at + 8 + size + (size & 1)
    if (end > b.length + (size & 1)) throw bad()
    const chunk = b.slice(at, Math.min(end, b.length))
    if (ascii(b, at, 'VP8X')) chunk[8] = chunk[8]! & ~0x0c
    if (!ascii(b, at, 'EXIF') && !ascii(b, at, 'XMP ')) parts.push(chunk)
    at = end
  }
  const out = join([b.subarray(0, 12), ...parts])
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  return out
}
