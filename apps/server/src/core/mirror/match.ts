import { sql } from '@payloadcms/db-postgres'

export const MIN_WORD_LENGTH = 4
export const MIN_SHARED_WORDS = 2

export const queryWords = (text: string): string[] => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.filter((word) => [...word].length >= MIN_WORD_LENGTH))]
}

export const requiredShared = (words: string[]): number => Math.min(MIN_SHARED_WORDS, words.length)

export const anyWord = (words: string[]) => sql`websearch_to_tsquery('simple', ${words.join(' or ')})`

export const sharedWords = (vector: ReturnType<typeof sql>, words: string[]) => sql`(
  SELECT count(*) FROM jsonb_array_elements_text(${JSON.stringify(words)}::jsonb) AS q("word")
  WHERE ${vector} @@ plainto_tsquery('simple', q."word"))`
