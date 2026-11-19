import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

export const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')

export type FoundComment = { start: number; end: number; line: number; text: string; allowed: string | null }

const DIRECTIVES: [string, RegExp][] = [
  ['ts-directive', /@ts-(expect-error|nocheck)/],
  ['triple-slash', /^\/\/\/\s*<reference/],
  ['shebang', /^#!/],
  ['eslint', /eslint-disable[^\n]*\s--\s+\S/],
  ['coverage', /\b(c8|istanbul) ignore/],
  ['bundler-hint', /webpackChunkName|@vite-ignore/],
  ['license', /license|copyright|SPDX-License/i],
]
const EXTERNAL_TRACKER = /https?:\/\/(?:github|gitlab)\.com\/(?!getbauherr\/)[\w.-]+\/[\w.-]+\/(?:issues|pull|merge_requests|discussions)\//
const PUBLIC_API = /^packages\/(?:cli|adapters)\/src\//

export function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '--', 'apps', 'packages'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith('/next-env.d.ts'))
}

function classify(file: string, text: string, start: number, end: number): string | null {
  const body = text.slice(start, end)
  for (const [reason, re] of DIRECTIVES) if (re.test(body) && (reason !== 'license' || start === 0)) return reason
  if (EXTERNAL_TRACKER.test(body)) return 'external-tracker'
  if (body.startsWith('/**') && PUBLIC_API.test(file) && /^\s*export\b/.test(text.slice(end))) return 'public-api-jsdoc'
  return null
}

export function scanComments(file: string, text = readFileSync(join(repoRoot, file), 'utf8')): FoundComment[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const seen = new Map<number, FoundComment>()
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    const children = node.getChildren(sf)
    if (children.length) return children.forEach(visit)
    if (node.kind === ts.SyntaxKind.JsxText) return
    const ranges = [...(ts.getLeadingCommentRanges(text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]
    for (const r of ranges) {
      if (seen.has(r.pos)) continue
      const line = sf.getLineAndCharacterOfPosition(r.pos).line + 1
      seen.set(r.pos, { start: r.pos, end: r.end, line, text: text.slice(r.pos, r.end), allowed: classify(file, text, r.pos, r.end) })
    }
  }
  visit(sf)
  return [...seen.values()].sort((a, b) => a.start - b.start)
}

export function bannedComments(file: string): FoundComment[] {
  return scanComments(file).filter((c) => !c.allowed)
}
