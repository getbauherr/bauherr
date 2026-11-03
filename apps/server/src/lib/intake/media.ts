import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { secret } from '../secrets'

type Doc = Record<string, any>

/** Upload limits from the environment (D2): `MEDIA_MAX_BYTES` (default 5 MiB), `MEDIA_MAX_PER_SESSION` (default 5). */
export const mediaLimits = (): { maxBytes: number; maxPerSession: number } => ({
  maxBytes: Number(process.env.MEDIA_MAX_BYTES) || 5 * 1024 * 1024,
  maxPerSession: Number(process.env.MEDIA_MAX_PER_SESSION) || 5,
})

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

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const satisfies Record<ImageMime, string>

const sign = (id: number | string): string => createHmac('sha256', secret('PAYLOAD_SECRET')).update(`media:${id}`).digest('base64url')

/** Whether `sig` (with or without a trailing `.ext`) is the signature of media `id`. */
export const verifyMediaSig = (id: number | string, sig: string): boolean => {
  const [got, want] = [Buffer.from(sig.replace(/\.\w+$/, '')), Buffer.from(sign(id))]
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Public, unguessable, non-expiring link `${PUBLIC_URL}/m/<id>/<sig>.<ext>`; the extension only makes forge image proxies treat it as an image. Rotating `PAYLOAD_SECRET` invalidates every link. */
export const mediaUrl = (id: number | string, mime: ImageMime): string =>
  `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/m/${id}/${sign(id)}.${EXT[mime]}`

export class MediaRejected extends Error {}

/** Sniffs, strips metadata and stores one image in the `media` collection (local volume or S3, whichever is configured). Throws `MediaRejected` for a non-image or corrupt file. */
export const saveMedia = async (
  payload: Payload,
  a: { bytes: Uint8Array; name: string; workspace: number | string; session?: number | string; product?: number | string; ticketNumber?: number },
): Promise<Doc> => {
  const mime = sniff(a.bytes)
  if (!mime) throw new MediaRejected('only png, jpeg or webp images')
  let clean: Uint8Array
  try {
    clean = stripMetadata(a.bytes, mime)
  } catch {
    throw new MediaRejected('corrupt image')
  }
  const name = a.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'screenshot'
  return (await payload.create({
    collection: 'media',
    data: { name, mime, workspace: a.workspace, session: a.session, product: a.product, ticketNumber: a.ticketNumber },
    file: { data: Buffer.from(clean), name, mimetype: mime, size: clean.length },
    overrideAccess: true,
  })) as Doc
}

/** The bytes of a stored image: legacy rows from `data`, then the S3 handler when configured, then the local volume, so files written under the other store stay readable after switching. */
export const mediaBytes = async (payload: Payload, doc: Doc): Promise<Uint8Array> => {
  if (doc.data) return Buffer.from(doc.data, 'base64')
  const upload = payload.collections.media!.config.upload
  for (const handler of upload.handlers ?? []) {
    try {
      const res = await handler({ ...(await createLocalReq({}, payload)), headers: new Headers() } as PayloadRequest, { doc: doc as { id: number | string }, headers: new Headers(), params: { collection: 'media', filename: doc.filename, prefix: doc.prefix } })
      if (res instanceof Response && res.ok) return new Uint8Array(await res.arrayBuffer())
    } catch {}
  }
  try {
    return await readFile(path.resolve(upload.staticDir!, path.basename(doc.filename)))
  } catch {
    throw new Error(`media ${doc.id} unreadable`)
  }
}
