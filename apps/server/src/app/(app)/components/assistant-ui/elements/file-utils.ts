import type { FC } from 'react'
import { FileIcon, FileTextIcon, ImageIcon, MusicIcon, VideoIcon, BracesIcon } from 'lucide-react'

export function getMimeTypeIcon(mimeType: string): FC<{
  className?: string
}> {
  const type = mimeType.toLowerCase()
  if (type.startsWith('image/')) {
    return ImageIcon
  }
  if (type === 'application/pdf') {
    return FileTextIcon
  }
  if (type === 'application/json') {
    return BracesIcon
  }
  if (type.startsWith('text/')) {
    return FileTextIcon
  }
  if (type.startsWith('audio/')) {
    return MusicIcon
  }
  if (type.startsWith('video/')) {
    return VideoIcon
  }
  return FileIcon
}
export type FileDataKind = 'data-uri' | 'url' | 'base64' | 'id'
export function getFileDataKind(data: string, sourceType?: 'url' | 'id'): FileDataKind {
  if (sourceType === 'url' && /^data:/i.test(data)) return 'data-uri'
  if (sourceType === 'url' || sourceType === 'id') return sourceType
  if (/^data:/i.test(data)) return 'data-uri'
  if (/^(https?:\/\/|blob:)/i.test(data)) return 'url'
  return 'base64'
}
function isUnsafeScheme(data: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(data) && !/^(data:|https?:\/\/|blob:)/i.test(data)
}
export function getFileHref(data: string, mimeType: string, sourceType?: 'url' | 'id'): string | null {
  if (isUnsafeScheme(data)) return null
  const kind = getFileDataKind(data, sourceType)
  if (kind === 'id') return null
  if (kind === 'data-uri') return /^data:[^,]*,/i.test(data) ? data : null
  if (kind === 'url') return /^(https?:\/\/|blob:)/i.test(data) ? data : null
  return `data:${mimeType};base64,${data}`
}
function getBase64PayloadSize(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const firstNonBase64 = payload.search(/[^A-Za-z\d+/]/)
  if (
    (firstNonBase64 !== -1 && firstNonBase64 !== payload.length - padding) ||
    payload.length % 4 === 1 ||
    (padding > 0 && payload.length % 4 !== 0)
  ) {
    return 0
  }
  return Math.floor((payload.length * 3) / 4) - padding
}
export function getBase64Size(base64: string): number {
  const payload = /[\t\n\f\r ]/.test(base64) ? base64.replace(/[\t\n\f\r ]/g, '') : base64
  return getBase64PayloadSize(payload)
}
export function getDataUrlSize(data: string): number {
  const fragment = data.indexOf('#')
  const end = fragment < 0 ? data.length : fragment
  const comma = data.indexOf(',')
  if (comma < 0 || comma >= end) {
    return 0
  }
  let payload = data.slice(comma + 1, end)
  if (/;base64$/i.test(data.slice(0, comma))) {
    if (/[%\t\n\f\r ]/.test(payload)) {
      payload = payload
        .replace(/%([\da-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/[\t\n\f\r ]/g, '')
    }
    return getBase64PayloadSize(payload)
  }
  return new TextEncoder().encode(payload.replace(/%[\da-f]{2}/gi, '_')).byteLength
}
export function getFileLabel(mimeType: string): string {
  const subtype = /^[^/;]+\/(?:x-)?(?:[^;+]*\.)?([^;+.\s]+)/.exec(mimeType.toLowerCase())?.[1]
  if (!subtype || subtype === 'octet-stream') return 'File'
  if (subtype === 'plain') return 'Text file'
  return `${subtype.toUpperCase()} file`
}
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
