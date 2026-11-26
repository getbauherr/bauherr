import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseTokens } from '../scripts/design-tokens'

const tokens = parseTokens(readFileSync(join(__dirname, '..', '..', '..', 'docs/design/tokens.json'), 'utf8'))

const resolve = (name: string, theme: 'light' | 'dark'): string => {
  const token = tokens.color.tokens.find((c) => c.name === name)
  if (!token) throw new Error(`unknown token ${name}`)
  if (typeof token.value === 'string') return resolve(token.value.slice(1, -1), theme)
  return token.value[theme]
}

const channel = (hex: string, at: number) => {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const surfaces = ['surface-000', 'surface-100', 'surface-200']
const pairs: [string, string][] = [
  ...['ink', 'ink-muted', 'accent', 'accent-2', 'ok', 'warn', 'danger'].flatMap((fg): [string, string][] =>
    surfaces.map((bg) => [fg, bg]),
  ),
  ['ink', 'accent-soft'],
  ['ink-muted', 'accent-soft'],
  ['accent', 'accent-soft'],
  ['accent-2', 'accent-2-soft'],
  ['warn', 'warn-soft'],
  ['danger', 'danger-soft'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-strong'],
  ['on-accent-2', 'accent-2'],
  ['on-accent-2', 'accent-2-strong'],
]

it.each(pairs.flatMap(([fg, bg]) => (['light', 'dark'] as const).map((theme) => [fg, bg, theme] as const)))(
  '%s on %s is at least 4.5:1 in %s',
  (fg, bg, theme) => {
    expect(ratio(resolve(fg, theme), resolve(bg, theme))).toBeGreaterThanOrEqual(4.5)
  },
)

it('ok follows accent-2 and focus follows accent', () => {
  expect(resolve('ok', 'dark')).toBe(resolve('accent-2', 'dark'))
  expect(resolve('focus', 'light')).toBe(resolve('accent', 'light'))
})
