import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const roots = [join(root, 'apps/server/src'), join(root, 'packages/runner/src')]
const N = '(triage|plan|parent|build|review|release|done)'
const PATTERNS = [
  new RegExp(`\\.stage\\s*[!=]==?\\s*'${N}'`),
  new RegExp(`stage:\\s*(\\{\\s*equals:\\s*)?'${N}'(?!\\s*\\|)`),
  new RegExp(`moveStage\\([^()]*,\\s*'${N}'`),
  /waitingFor:\s*'(plan|build|review|release)'/,
]
const ALLOWED: Record<string, string> = {
  'apps/server/src/lib/workflow.ts': 'the one module that derives stage names',
  'apps/server/src/lib/stage-text.ts': 'maps stage names to kinds for text columns',
}

const files = (dir: string): string[] =>
  statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).flatMap((f) => (f === 'node_modules' || f === 'dist' ? [] : files(join(dir, f)))) : /\.tsx?$/.test(dir) ? [dir] : []

it('no file but the workflow modules names a default stage', () => {
  const offenders = roots.flatMap(files).flatMap((f) => {
    const rel = relative(root, f)
    if (rel in ALLOWED) return []
    return readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (PATTERNS.some((p) => p.test(line)) ? [`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`] : []))
  })
  expect(offenders).toEqual([])
})
