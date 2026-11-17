import type { Feature } from './feature-map'

export type Selector = { kind: 'id'; value: string } | { kind: 'area'; value: string } | { kind: 'changed'; files: string[] }

export interface Plan {
  vitest: string[]
  packages: string[]
  node: string[]
  e2e: string[]
}

const norm = (s: string) => s.toLowerCase()
const touches = (paths: string[], file: string) => paths.some((p) => file === p || file.startsWith(`${p}/`))

export const resolveFeatures = (features: Feature[], selector: Selector): Feature[] => {
  if (selector.kind === 'id') return features.filter((f) => f.id === selector.value)
  if (selector.kind === 'area') return features.filter((f) => norm(f.area) === norm(selector.value))
  return features.filter((f) => selector.files.some((file) => touches(f.source, file) || touches(f.tests, file)))
}

export const classify = (tests: string[]): Plan => {
  const plan: Plan = { vitest: [], packages: [], node: [], e2e: [] }
  for (const t of tests) {
    const pkg = t.match(/^packages\/([^/]+)\//)
    if (pkg) plan.packages.push(pkg[1])
    else if (t.endsWith('.spec.ts')) plan.e2e.push(t)
    else if (t.endsWith('.e2e.ts')) plan.node.push(t)
    else plan.vitest.push(t)
  }
  return plan
}

export const planOf = (feature: Feature): Plan => classify([...new Set(feature.tests)])

export const pagesOf = (features: Feature[]): { id: string; page: string }[] =>
  features.filter((f) => f.page && !f.page.includes('[')).map((f) => ({ id: f.id, page: f.page as string }))

export const parseArgs = (argv: string[]): { selector: Selector | null; e2e: boolean; out?: string; base: string } => {
  const args = argv.slice()
  const flag = (name: string) => {
    const i = args.indexOf(name)
    if (i < 0) return false
    args.splice(i, 1)
    return true
  }
  const e2e = flag('--e2e')
  let out: string | undefined
  const oi = args.indexOf('--out')
  if (oi >= 0) [, out] = args.splice(oi, 2)
  const ci = args.indexOf('--changed')
  if (ci >= 0) {
    const next = args[ci + 1]
    const base = next && !next.startsWith('--') ? next : 'origin/main'
    return { selector: { kind: 'changed', files: [] }, e2e, out, base }
  }
  const value = args[0]
  return { selector: value ? { kind: 'id', value } : null, e2e, out, base: 'origin/main' }
}
