import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const roots = [join(root, 'apps/server/src'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))]
/** Files allowed to list stage names, each with the reason. */
const ALLOWED: Record<string, string> = {
  'apps/server/src/lib/workflow.ts': 'the one module that derives every stage list',
  'apps/server/src/lib/actions.ts': 'ad-hoc subsets (stages past the Expedite lane, latest build/review Run lookups); move to kinds with the outcome step',
  'apps/server/src/jobs/index.ts': 'ad-hoc subset (plan/build tickets swept for plan approval); move to kinds with the outcome step',
  'apps/server/src/app/(app)/(shell)/settings/actions.ts': 'Workspace mode form offers plan and build only; moves with per-Workspace config',
  'apps/server/src/app/(app)/(shell)/settings/workspace/page.tsx': 'Workspace mode form offers plan and build only; moves with per-Workspace config',
}

const files = (dir: string): string[] =>
  statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).flatMap((f) => (f === 'node_modules' || f === 'dist' ? [] : files(join(dir, f)))) : /\.tsx?$/.test(dir) ? [dir] : []

it('no file but lib/workflow.ts lists stage names in an array literal', () => {
  const offenders = roots.flatMap(files).flatMap((f) => {
    const rel = relative(root, f)
    if (rel in ALLOWED) return []
    const lists = readFileSync(f, 'utf8').match(/\[[^\[\]]*,[^\[\]]*\]/g) ?? []
    return lists.some((l) => (l.match(/(['"`])(triage|plan|build|review|release|done)\1/g) ?? []).length >= 2) ? [rel] : []
  })
  expect(offenders).toEqual([])
})
