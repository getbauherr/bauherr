import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot as root } from './helpers/comments'

const HTML =
  /^<\/?(a|br|details|div|figcaption|figure|iframe|img|kbd|p|picture|section|source|span|sub|summary|sup|video)\b/

const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name)
    if (e.isDirectory()) return pages(file)
    return e.name.endsWith('.md') && e.name !== 'features.md' ? [realpathSync(file)] : []
  })

export const bareTags = (text: string): string[] => {
  let fenced = false
  return text.split('\n').flatMap((line, i) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      return []
    }
    if (fenced) return []
    return [...line.replace(/`[^`]*`/g, '').matchAll(/<[a-zA-Z][^>]*>/g)]
      .filter((m) => !HTML.test(m[0]))
      .map((m) => `${i + 1}: ${m[0]}`)
  })
}

describe('published docs', () => {
  it('flags a placeholder that the browser would read as an element', () => {
    expect(bareTags('Inbox shows "Fast lane for <title>?"\n<section class="x" markdown>\n`<stage>`')).toEqual([
      '1: <title>',
    ])
  })

  it('have no bare placeholder tags', () => {
    const bad = pages(path.join(root, 'docs/site/docs')).flatMap((f) =>
      bareTags(readFileSync(f, 'utf8')).map((hit) => `${path.relative(root, f)}:${hit}`),
    )
    expect(
      bad,
      'A bare <placeholder> starts an HTML element and cuts the rest of the ' +
        'page off: write &lt;placeholder> or put it in backticks',
    ).toEqual([])
  })
})
