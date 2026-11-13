import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { diffDesign } from '../scripts/design-md'

const root = join(__dirname, '..', '..', '..')
const tokens = JSON.parse(readFileSync(join(root, 'docs/design/tokens.json'), 'utf8'))
const md = readFileSync(join(root, 'DESIGN.md'), 'utf8')
const change = (from: string, to: string) => {
  expect(md).toContain(from)
  return md.replace(from, to)
}

it('DESIGN.md equals docs/design/tokens.json', () => {
  expect(diffDesign(tokens, md)).toEqual([])
})

it('a changed front matter colour, dark value and duration each fail naming the token', () => {
  expect(diffDesign(tokens, change('accent: "#2457c5"', 'accent: "#2457c6"'))).toEqual(['colors.accent: expected #2457c5, got #2457c6'])
  expect(diffDesign(tokens, change('#8db1ff', '#8db1fe'))).toEqual(['table.colors.accent.dark: expected #8db1ff, got #8db1fe'])
  expect(diffDesign(tokens, change('| 320ms |', '| 300ms |'))).toEqual(['table.motion.duration-state.value: expected 320ms, got 300ms'])
})

it('a changed type style and spacing value fail naming the token', () => {
  expect(diffDesign(tokens, change('fontSize: 15px', 'fontSize: 16px'))).toEqual(['typography.body.fontSize: expected 15px, got 16px'])
  expect(diffDesign(tokens, change('| `space-3` | 12px |', '| `space-3` | 14px |'))).toEqual(['table.layout.space-3.value: expected 12px, got 14px'])
})

it('an unresolved component reference fails', () => {
  expect(diffDesign(tokens, change('backgroundColor: "{colors.accent-soft}"', 'backgroundColor: "{colors.accent-softer}"'))).toEqual([
    'components.selected-row.backgroundColor: expected a defined token, got {colors.accent-softer}',
  ])
})
