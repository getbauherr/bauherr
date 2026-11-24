import { imageTypeOf, UploadRefused } from '../attachments/image'
import { FILE_MAX_BYTES, TEXT_FILE_TYPES } from './limits'

const PDF_MAGIC = '%PDF-'
const TEXT_TYPES: readonly string[] = TEXT_FILE_TYPES

const REFUSED_TYPE = 'Only images (PNG, JPEG, WebP), PDF and text files can be attached.'

const isText = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

const isPdf = (bytes: Uint8Array): boolean =>
  Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString('latin1') === PDF_MAGIC

const sniffed = (declared: string, bytes: Uint8Array): string | null => {
  if (declared.startsWith('image/')) return imageTypeOf(bytes)
  if (declared === 'application/pdf') return isPdf(bytes) ? declared : null
  if (TEXT_TYPES.includes(declared)) return isText(bytes) ? declared : null
  return null
}

export const checkedFile = (declaredType: string, bytes: Uint8Array): string => {
  if (bytes.length === 0) throw new UploadRefused('The request has no body: send the file as the body.', 400)
  if (bytes.length > FILE_MAX_BYTES) throw new UploadRefused('The file is larger than 10 MB: shrink it.', 413)
  const type = sniffed(declaredType.split(';')[0]?.trim() ?? '', bytes)
  if (type === null) throw new UploadRefused(REFUSED_TYPE, 415)
  return type
}
