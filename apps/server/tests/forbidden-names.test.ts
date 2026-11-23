import { describe, expect, test } from 'vitest'
import {
  FORBIDDEN_MESSAGE,
  FORBIDDEN_NAMES_VAR,
  parseForbidden,
  readText,
  scanForbidden,
  trackedFiles,
} from './helpers/forbidden-names'

const forbidden = parseForbidden(process.env[FORBIDDEN_NAMES_VAR])

describe('forbidden names', () => {
  test.skipIf(forbidden.length === 0)(
    `no tracked file names an installation (skipped without ${FORBIDDEN_NAMES_VAR})`,
    () => {
      const hits = scanForbidden(trackedFiles(), readText, forbidden)
      expect(hits.map((h) => `${h.file}: contains "${h.name}". ${FORBIDDEN_MESSAGE}`)).toEqual([])
    },
  )

  test('without the variable the structural scan is skipped, loudly', () => {
    if (forbidden.length === 0) {
      console.warn(`${FORBIDDEN_NAMES_VAR} is not set: the forbidden-names scan did not run`)
    }
    expect(parseForbidden(undefined)).toEqual([])
  })
})

describe('scanForbidden', () => {
  const files: Record<string, string | null> = {
    'a.md': 'host Acme.Example here',
    'b.md': 'clean',
    'c.bin': null,
    'acme.example.txt': 'x',
  }
  const read = (f: string) => files[f] ?? null

  test('names the file and the string, case-insensitively', () => {
    expect(scanForbidden(Object.keys(files), read, parseForbidden('ACME.example'), {})).toEqual([
      { file: 'a.md', name: 'acme.example' },
      { file: 'acme.example.txt', name: 'acme.example' },
    ])
  })

  test('an allow-listed file is not reported', () => {
    expect(scanForbidden(['a.md'], read, ['acme.example'], { 'a.md': 'reason' })).toEqual([])
  })

  test('the failure message says what to do', () => {
    expect(FORBIDDEN_MESSAGE).toMatch(/neutral name.*configuration/)
  })
})
