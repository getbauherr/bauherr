import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadMap, root } from './feature-map'
import { pagesOf, parseArgs, planOf, resolveFeatures, type Selector } from './verify-resolve'

const serverDir = path.join(root, 'apps/server')
const rel = (p: string) => p.replace(/^apps\/server\//, '')
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env }).status === 0

const { selector, e2e, out, base } = parseArgs(process.argv.slice(2))
const map = loadMap()

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const select = (): Selector => {
  if (!selector) return fail('usage: pnpm verify <feature-id | area | --changed [base]> [--e2e] [--out dir]')
  if (selector.kind === 'changed') {
    const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    return { kind: 'changed', files }
  }
  return map.features.some((f) => f.id === selector.value) ? selector : { kind: 'area', value: selector.value }
}

const features = resolveFeatures(map.features, select())
if (!features.length) fail('no feature matches')
if (e2e && !process.env.BASE_URL) fail('--e2e needs BASE_URL')
if (e2e && !process.env.DATABASE_URL) fail('DATABASE_URL is needed for the vitest files')

const outDir = out ?? path.join(serverDir, 'e2e/results')
const done = new Map<string, boolean>()
const once = (key: string, go: () => boolean) => {
  if (!done.has(key)) done.set(key, go())
  return done.get(key) as boolean
}

const proofs = new Map<string, string>()
if (e2e) {
  const pages = pagesOf(features)
  if (pages.length) {
    once('proof', () =>
      run('npx', ['playwright', 'test', 'e2e/verify-proof.spec.ts'], {
        ...process.env,
        VERIFY_PAGES: pages.map((p) => `${p.id}=${p.page}`).join(','),
        VERIFY_OUT: outDir,
      }),
    )
    for (const { id } of pages) {
      const file = path.join(outDir, 'proof', `${id}.png`)
      if (existsSync(file)) proofs.set(id, file)
    }
  }
}

const rows = features.map((feature) => {
  const plan = planOf(feature)
  const results: boolean[] = []
  const ran: string[] = []
  const vitest = plan.vitest.filter((t) => !done.has(`v:${t}`))
  if (plan.vitest.length) {
    if (vitest.length) {
      const ok = run('pnpm', ['--filter', 'server', 'test', ...vitest.map(rel)])
      for (const t of vitest) done.set(`v:${t}`, ok)
    }
    results.push(...plan.vitest.map((t) => done.get(`v:${t}`) as boolean))
    ran.push(`${plan.vitest.length} vitest`)
  }
  for (const pkg of new Set(plan.packages)) results.push(once(`pkg:${pkg}`, () => run('pnpm', ['--filter', `@bauherr/${pkg}`, 'test'])))
  if (plan.packages.length) ran.push(`${new Set(plan.packages).size} package`)
  for (const t of plan.node) results.push(once(`n:${t}`, () => run('pnpm', ['--filter', 'server', 'exec', 'tsx', '--test', '--test-force-exit', rel(t)])))
  if (plan.node.length) ran.push(`${plan.node.length} node:test`)
  if (plan.e2e.length) {
    if (e2e) results.push(once(`e:${plan.e2e.join(',')}`, () => spawnSync('npx', ['playwright', 'test', ...plan.e2e.map(rel)], { cwd: serverDir, stdio: 'inherit' }).status === 0))
    ran.push(`${plan.e2e.length} e2e${e2e ? '' : ' (not run, --e2e)'}`)
  }
  const capturable = pagesOf([feature]).length > 0
  const proof = proofs.get(feature.id) ?? (feature.proof !== 'screenshot' ? (feature.proof ?? '-') : !capturable ? 'dynamic route' : e2e ? 'missing' : 'with --e2e')
  const result = !results.length ? 'no tests' : results.every(Boolean) ? 'pass' : 'FAIL'
  return { feature: feature.id, tests: ran.join(', ') || '-', result, proof, ok: results.every(Boolean) && proof !== 'missing' }
})

const width = (key: 'feature' | 'tests' | 'result') => Math.max(key.length, ...rows.map((r) => r[key].length))
const line = (r: { feature: string; tests: string; result: string; proof: string }) =>
  `${r.feature.padEnd(width('feature'))} | ${r.tests.padEnd(width('tests'))} | ${r.result.padEnd(width('result'))} | ${r.proof}`
console.log(['\n' + line({ feature: 'feature', tests: 'tests run', result: 'result', proof: 'proof' }), ...rows.map(line)].join('\n'))
process.exit(rows.every((r) => r.ok) ? 0 : 1)
