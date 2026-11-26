const EMAIL = /\S+@\S+\.\S+/g
const URL_LIKE = /https?:\/\/\S+/g
const TAG = /<[^>]*>/g
const REFERENCE = /(?:\b[\w.-]+\/[\w.-]+)?#\d+/g
const LEAD = /^[\s\-*•]+/

export const clean = (text: string): string =>
  text
    .replace(TAG, ' ')
    .replace(EMAIL, ' ')
    .replace(URL_LIKE, ' ')
    .replace(REFERENCE, ' ')
    .replace(/[@`*_[\]<>]/g, '')
    .replace(/\s+/g, ' ')
    .replace(LEAD, '')
    .trim()

export const words = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '')

export const firstWords = (text: string, max: number): string => words(text).slice(0, max).join(' ')

export const sentence = (text: string, max: number): string => {
  const first = clean(text).split(/(?<=[.!?])\s+/)[0] ?? ''
  const cut = firstWords(first, max).replace(/[,;:\s]+$/, '')
  if (cut === '') return ''
  const capital = `${cut.charAt(0).toUpperCase()}${cut.slice(1)}`
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

export const title = (text: string, max: number): string => {
  const cut = firstWords(clean(text).replace(/[.!?:;,]+$/, ''), max)
  return `${cut.charAt(0).toUpperCase()}${cut.slice(1)}`
}
