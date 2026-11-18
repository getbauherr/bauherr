import { expect, test } from 'vitest'
import { bannedComments, sourceFiles } from './helpers/comments'

test('no code comments outside the allowlist', () => {
  const hits = sourceFiles().flatMap((f) => bannedComments(f).map((c) => `${f}:${c.line} Comments are banned: encode it as a name, type, test or check (allowlist: docs/references.md#pstack).`))
  expect(hits).toEqual([])
})
