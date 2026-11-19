import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot as root } from './helpers/comments'

export const MAX_PAGE_WORDS = 1500
export const MAX_SENTENCE_WORDS = 30
export const WORDS_PER_PARENTHESIS = 150
export const FILLER = ['note that', 'simply', 'basically', 'in order to', 'it is important', 'please', 'seamless', 'robust', 'leverage', 'out of the box', 'under the hood', 'as mentioned', 'in other words', 'of course', 'obviously']

const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name)
    if (e.isDirectory()) return pages(file)
    return e.name.endsWith('.md') && e.name !== 'features.md' ? [realpathSync(file)] : []
  })

export const prose = (text: string): string =>
  text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, 'x').replace(/<[^>]+>/g, ' ').replace(/\]\([^)]*\)/g, ']')

export const sentences = (text: string): string[] =>
  prose(text).split('\n').flatMap((line) => line.split('|')).flatMap((cell) => cell.split(/(?<=[.!?:;])\s+/)).map((s) => s.trim()).filter(Boolean)

export const styleProblems = (text: string): string[] => {
  const words = prose(text).split(/\s+/).filter(Boolean).length
  const parens = (prose(text).match(/\(/g) ?? []).length
  const lower = prose(text).toLowerCase()
  return [
    ...(words > MAX_PAGE_WORDS ? [`${words} words, budget ${MAX_PAGE_WORDS}: cut, or move behaviour into a check, test or the feature map`] : []),
    ...sentences(text).filter((s) => s.split(/\s+/).length > MAX_SENTENCE_WORDS).map((s) => `sentence over ${MAX_SENTENCE_WORDS} words, split it: "${s.slice(0, 80)}…"`),
    ...(parens > Math.max(2, words / WORDS_PER_PARENTHESIS) ? [`${parens} parentheses: at most one per ${WORDS_PER_PARENTHESIS} words, make it its own sentence or drop it`] : []),
    ...FILLER.filter((f) => new RegExp(`\\b${f}\\b`).test(lower)).map((f) => `filler "${f}": delete it`),
  ]
}

describe('docs style', () => {
  it('reports each rule', () => {
    const long = `${'word '.repeat(31).trim()}.`
    expect(styleProblems(`${long}\nNote that (a) (b) (c) it works.`)).toEqual([
      expect.stringContaining('sentence over 30 words'),
      expect.stringContaining('parentheses'),
      'filler "note that": delete it',
    ])
    expect(styleProblems('Short and plain. `code (x) (y) (z)` stays out.\n```\n(a) (b) (c)\n```')).toEqual([])
  })

  it('published pages are short and plain', () => {
    const bad = pages(path.join(root, 'docs/site/docs')).flatMap((f) => styleProblems(readFileSync(f, 'utf8')).map((p) => `${path.relative(root, f)}: ${p}`))
    expect(bad, 'Docs rules: docs/README.md#style').toEqual([])
  })
})
