import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { tools } from '../src/lib/mcp-tools'
import { escapeTags, loadMap, PROOFS, render, root, STATUSES } from '../scripts/feature-map'

const map = loadMap()
const features = map.features
const rel = (file: string) => path.relative(root, file)
const missing = (list: string[]) => list.filter((p) => !existsSync(path.join(root, p)))

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

const shellDir = path.join(root, 'apps/server/src/app/(app)/(shell)')
const shellRoutes = walk(shellDir)
  .filter((f) => f.endsWith('/page.tsx'))
  .map((f) => '/' + path.relative(shellDir, path.dirname(f)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)).join('/'))

const referenceIds = [...readFileSync(path.join(root, 'docs/references.md'), 'utf8').matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1])

const frontmatterSources = () => {
  const files = [
    ...readdirSync(path.join(root, 'pack/skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, 'pack/skills', e.name, 'SKILL.md')),
    ...readdirSync(path.join(root, 'pack/rules')).map((f) => path.join(root, 'pack/rules', f)),
  ].filter((f) => existsSync(f) && f.endsWith('.md'))
  return files.flatMap((file) => {
    const match = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)
    const sources: unknown = match ? (parse(match[1]) as { sources?: unknown } | null)?.sources : undefined
    return (Array.isArray(sources) ? sources : []).map((id) => ({ file: rel(file), id: String(id) }))
  })
}

describe('feature map', () => {
  it('escapes bare tags outside code so the page is not cut off', () => {
    expect(escapeTags('Inbox shows "Fast lane for <title>?" and `/workflow/<stage>`')).toBe('Inbox shows "Fast lane for &lt;title>?" and `/workflow/<stage>`')
    expect(render(map).split(/`[^`]*`/).join('')).not.toMatch(/<[a-z]/i)
  })

  it('has valid statuses and unique ids', () => {
    const bad = features.filter((f) => !STATUSES.includes(f.status)).map((f) => `${f.id}: ${f.status}`)
    expect(bad, `docs/feature-map.yaml: status must be one of ${STATUSES.join(', ')}`).toEqual([])
    const ids = features.map((f) => f.id)
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    expect(dupes, 'docs/feature-map.yaml: feature ids must be unique, rename these').toEqual([])
  })

  it('names a proof kind for every feature', () => {
    const bad = features.filter((f) => !PROOFS.includes(f.proof)).map((f) => `${f.id}: ${f.proof}`)
    expect(bad, `docs/feature-map.yaml: proof must be one of ${PROOFS.join(', ')}`).toEqual([])
  })

  it('lists only source and test paths that exist', () => {
    const bad = features.flatMap((f) => missing([...f.source, ...f.tests]).map((p) => `${f.id}: ${p}`))
    expect(bad, 'docs/feature-map.yaml: these source/tests paths do not exist; fix or remove them').toEqual([])
  })

  it('has tests for every feature unless it is in progress', () => {
    const bare = features.filter((f) => f.tests.length === 0 && f.status !== 'in-progress').map((f) => f.id)
    expect(bare, 'docs/feature-map.yaml: add existing vitest/Playwright test paths under `tests`; an empty list is allowed only with status: in-progress').toEqual([])
  })

  it('covers every (shell) page route', () => {
    const covered = new Set(features.flatMap((f) => [f.page, ...(f.pages ?? [])]).filter(Boolean))
    const loose = shellRoutes.filter((r) => !covered.has(r))
    expect(loose, 'docs/feature-map.yaml: add each route as `page` or in `pages` of the feature it belongs to (or add a feature)').toEqual([])
    const stale = [...covered].filter((r) => !shellRoutes.includes(r as string))
    expect(stale, 'docs/feature-map.yaml: these page/pages routes have no (shell) page.tsx; fix the route').toEqual([])
  })

  it('covers every MCP tool', () => {
    const names = tools.map((t) => t.name)
    const listed = new Set(features.flatMap((f) => f.mcp))
    expect(names.filter((n) => !listed.has(n)), 'docs/feature-map.yaml: add each tool to the `mcp` list of the feature it belongs to').toEqual([])
    expect([...listed].filter((n) => !names.includes(n)), 'docs/feature-map.yaml: these `mcp` names are not tools of apps/server/src/lib/mcp-tools.ts').toEqual([])
  })

  it('renders every feature and area into the generated page', () => {
    const page = render(map)
    expect(features.filter((f) => !page.includes(`| ${f.title} |`)).map((f) => f.id), 'scripts/feature-map.ts render dropped these features').toEqual([])
  })

  it('cites only known references in skill and rule frontmatter', () => {
    const unknown = frontmatterSources().filter((s) => !referenceIds.includes(s.id)).map((s) => `${s.file}: ${s.id}`)
    expect(unknown, 'docs/references.md: add these ids to the table or fix the `sources` frontmatter').toEqual([])
  })
})
