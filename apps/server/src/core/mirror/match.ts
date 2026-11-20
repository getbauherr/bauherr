import { sql } from '@payloadcms/db-postgres'

export const MIN_WORD_LENGTH = 4
export const MIN_SHARED_WORDS = 2

export const queryWords = (text: string): string[] => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.filter((word) => [...word].length >= MIN_WORD_LENGTH))]
}

export const anyWord = (words: string[]) => sql`websearch_to_tsquery('simple', ${words.join(' or ')})`

const contentWords = (words: string[]) => sql`(
  SELECT q."word" FROM jsonb_array_elements_text(${JSON.stringify(words)}::jsonb) AS q("word")
  WHERE numnode(plainto_tsquery('english', q."word")) > 0 AND numnode(plainto_tsquery('german', q."word")) > 0)`

export const sharedWords = (vector: ReturnType<typeof sql>, words: string[]) => sql`(
  SELECT count(*) FROM ${contentWords(words)} AS c("word") WHERE ${vector} @@ plainto_tsquery('simple', c."word"))`

export const sharesEnough = (vector: ReturnType<typeof sql>, words: string[]) => {
  const required = sql`least(${MIN_SHARED_WORDS}, (SELECT count(*) FROM ${contentWords(words)} AS r("word")))`
  return sql`${required} >= 1 AND ${sharedWords(vector, words)} >= ${required}`
}
