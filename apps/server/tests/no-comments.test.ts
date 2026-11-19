import { expect, test } from 'vitest'
import { bannedComments, scanComments, sourceFiles } from './helpers/comments'

const MESSAGE =
  'Comments are banned, trailing ones too: encode the reason as a name, type, test or check. ' +
  'Allowlist and the eslint-disable form (-- reason): pack/rules/no-comments.md.'

test('no code comments outside the allowlist', () => {
  const hits = sourceFiles().flatMap((f) => bannedComments(f).map((c) => `${f}:${c.line} ${MESSAGE}`))
  expect(hits).toEqual([])
})

test('a comment trailing code on the same line is found', () => {
  const found = scanComments('x.ts', 'const a = 1 // why\nconst b = 2\n')
  expect(found.map((c) => [c.line, c.allowed])).toEqual([[1, null]])
})

test('an eslint-disable without a description is banned, with one it is allowed', () => {
  const disable = '// eslint-disable-next-line no-undef'
  const [bare] = scanComments('x.ts', `const a = 1\n${disable}\nconst b = 2\n`)
  const [described] = scanComments('x.ts', `const a = 1\n${disable} -- the global exists at runtime\nconst b = 2\n`)
  expect([bare?.allowed, described?.allowed]).toEqual([null, 'eslint'])
})
