import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const roots = [join(root, 'apps/server/src'), join(root, 'apps/server/scripts'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))]
/** Files allowed to call DEFAULT() (the pack workflow), each with the reason. Everything Workspace-scoped uses workflowFor(). */
const ALLOWED: Record<string, string> = {
  'apps/server/src/lib/workflow.ts': 'defines DEFAULT()',
  'apps/server/src/lib/factory.ts': 'workflowFor() falls back to the pack default; the first apply compares against it; defaultHash',
  'apps/server/src/lib/wip-limits.ts': 'wipLimitsError validates a Workspace that does not exist yet against the pack default',
}

const files = (dir: string): string[] =>
  statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).flatMap((f) => (f === 'node_modules' || f === 'dist' ? [] : files(join(dir, f)))) : /\.tsx?$/.test(dir) ? [dir] : []

it('DEFAULT() is called only in the allow-listed files', () => {
  const offenders = roots.flatMap(files).map((f) => relative(root, f)).filter((rel) => !(rel in ALLOWED) && /\bDEFAULT\(\)/.test(readFileSync(join(root, rel), 'utf8')))
  expect(offenders).toEqual([])
})
