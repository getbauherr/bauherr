import { createHmac, timingSafeEqual } from 'node:crypto'

const ZERO_WIDTH = '​'
const CLOSING = /\b(clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))(?!\u200b)(?=\W+\S*(?:#\d|https?:))/gi
const SYNTAX = /[\\`*_{}[\]()<>#+\-!|~&]/g

/** Owner text made inert for a forge issue: one line, no mention, no closing keyword. */
export const inert = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/@(?!\u200b)/g, `@${ZERO_WIDTH}`)
    .replace(CLOSING, `$1${ZERO_WIDTH}`)

/** Owner text made inert and free of markdown syntax, keeping its line breaks. */
export const inertBlock = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => inert(line).replace(SYNTAX, '\\$&'))
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
