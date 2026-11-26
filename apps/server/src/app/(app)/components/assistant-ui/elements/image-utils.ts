import type { ImageMessagePart } from '@assistant-ui/react'
const extensionForMimeType = (mimeType?: string): string => {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'png'
  }
}
const splitDataUri = (dataUri: string) => {
  const commaIndex = dataUri.indexOf(',')
  const meta = commaIndex >= 0 ? dataUri.slice(0, commaIndex) : dataUri
  const data = commaIndex >= 0 ? dataUri.slice(commaIndex + 1) : ''
  const mime = meta.match(/data:([^;]+)/i)?.[1]?.toLowerCase() ?? 'application/octet-stream'
  return { meta, data, mime }
}
const percentDecodedBlob = (data: string, mime: string): Blob => {
  const parts: BlobPart[] = []
  let last = 0
  for (const match of data.matchAll(/(?:%[\da-f]{2})+/gi)) {
    if (match.index > last) parts.push(data.slice(last, match.index))
    const run = match[0]
    const escaped = new Uint8Array(run.length / 3)
    for (let index = 0; index < escaped.length; index++) {
      escaped[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16)
    }
    parts.push(escaped)
    last = match.index + run.length
  }
  parts.push(data.slice(last))
  return new Blob(parts, { type: mime })
}
const base64Blob = (data: string, mime: string): Blob | null => {
  let bytes: string
  try {
    const base64 = data.replace(/%([\da-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    bytes = atob(base64)
  } catch {
    return null
  }
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
const dataUriToBlob = (dataUri: string): Blob | null => {
  const { meta, data, mime } = splitDataUri(dataUri)
  return /;base64/i.test(meta) ? base64Blob(data, mime) : percentDecodedBlob(data, mime)
}
const mimeFromImage = (image: string): string | undefined => image.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
const defaultFilenameFromImage = (image: string): string => {
  const mime = mimeFromImage(image)
  if (mime) return `image.${extensionForMimeType(mime)}`
  try {
    const path = new URL(image, document.baseURI).pathname
    const encodedBasename = path.split('/').pop() ?? ''
    let basename = encodedBasename
    try {
      basename = decodeURIComponent(encodedBasename)
    } catch {}
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(basename)) return basename
  } catch {}
  return 'image.png'
}
const safeImageDownloadHref = (image: string): string | null => {
  try {
    const url = new URL(image, document.baseURI)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:' ? image : null
  } catch {
    return null
  }
}
export const downloadImagePart = (part: Pick<ImageMessagePart, 'image' | 'filename'>): void => {
  if (typeof document === 'undefined') return
  const filename = part.filename ?? defaultFilenameFromImage(part.image)
  const isDataUri = /^data:/i.test(part.image)
  const blob = isDataUri ? dataUriToBlob(part.image) : null
  if (isDataUri && !blob) return
  const objectUrl = blob ? URL.createObjectURL(blob) : null
  const href = objectUrl ?? safeImageDownloadHref(part.image)
  if (!href) return
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 40000)
}
export const copyImagePart = async (part: Pick<ImageMessagePart, 'image'>): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard API is not available in this environment.')
  }
  const blob = /^data:/i.test(part.image) ? dataUriToBlob(part.image) : await fetch(part.image).then((r) => r.blob())
  if (!blob) return
  const mime = mimeFromImage(part.image) ?? blob.type ?? 'image/png'
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })])
}
