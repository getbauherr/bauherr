import { createHmac, timingSafeEqual } from 'node:crypto'

const ZERO_WIDTH = '\u200b'
const CLOSING = /\b(clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))(?!\u200b)(?=\W+\S*(?:#\d|https?:))/gi
const SYNTAX = /[\\`*_{}[\]()<>#!|~&]/g
const LIST_START = /^(\s*)([-+=]|\d+[.)])/

export const inert = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/@(?!\u200b)/g, `@${ZERO_WIDTH}`)
    .replace(CLOSING, `$1${ZERO_WIDTH}`)

export const inertBlock = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => inert(line).replace(SYNTAX, '\\$&').replace(LIST_START, '$1\\$2'))
    .join('\n')

export const fileToken = (key: string, conversationId: number, fileId: number): string =>
  createHmac('sha256', key).update(`request-file:${conversationId}:${fileId}`).digest('base64url')

export const tokenFits = (key: string, conversationId: number, fileId: number, token: string): boolean => {
  const want = Buffer.from(fileToken(key, conversationId, fileId))
  const got = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

export const publicFileUrl = (origin: string, key: string, conversationId: number, fileId: number): string =>
  `${origin}/api/request-files/${conversationId}/${fileId}/${fileToken(key, conversationId, fileId)}`

const pictureToken = (key: string, recordId: number, attachmentId: number): string =>
  createHmac('sha256', key).update(`request-picture:${recordId}:${attachmentId}`).digest('base64url')

export const pictureTokenFits = (key: string, recordId: number, attachmentId: number, token: string): boolean => {
  const want = Buffer.from(pictureToken(key, recordId, attachmentId))
  const got = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

export const publicPictureUrl = (origin: string, key: string, recordId: number, attachmentId: number): string =>
  `${origin}/api/request-pictures/${recordId}/${attachmentId}/${pictureToken(key, recordId, attachmentId)}`
