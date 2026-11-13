import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { exceptions } from './a11y-exceptions'

const root = join(import.meta.dirname, '..')
const app = join(root, 'src', 'app')

const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name === 'page.tsx' ? [join(dir, e.name)] : []))

/** `(app)/(shell)/tickets/[id]/page.tsx` -> `/tickets/[id]` */
const route = (file: string) => `/${relative(app, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/')}`.replace(/\/$/, '') || '/'

const spec = readFileSync(join(root, 'e2e', 'a11y.spec.ts'), 'utf8')
const covered = new Set([...spec.matchAll(/^\s+'(\/[^']*)':/gm)].map((m) => m[1]!))

const all = pages(app).map(route)
const missing = all.filter((r) => !covered.has(r) && !(r in exceptions))
const stale = [...covered, ...Object.keys(exceptions)].filter((r) => !all.includes(r))

if (missing.length || stale.length) {
  if (missing.length) console.error(`Pages without an axe scan (add to routes in e2e/a11y.spec.ts, or to scripts/a11y-exceptions.ts with a reason):\n${missing.map((r) => `  ${r}`).join('\n')}`)
  if (stale.length) console.error(`Listed in the spec or exceptions but no such page.tsx:\n${stale.map((r) => `  ${r}`).join('\n')}`)
  process.exit(1)
}
console.log(`a11y coverage: ${all.length} pages, ${Object.keys(exceptions).length} exception(s)`)
