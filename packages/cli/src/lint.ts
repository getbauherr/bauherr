import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'

export type Finding = { file: string; line: number; msg: string }
export type LintOpts = { packDir: string; contextFile: string; specFile: string }

/** Per file kind: [path pattern, name, max lines, max bytes]. */
export const CAPS: [RegExp, string, number, number][] = [
  [/^(stacks\/[^/]+\/)?roles\/.+\.md$/, 'role profile', 40, 3000],
  [/^(stacks\/[^/]+\/)?rules\/.+\.md$/, 'rule', 60, 4000],
  [/^(stacks\/[^/]+\/)?skills\/.+\.md$/, 'skill file', 100, 6000],
  [/^(stacks\/[^/]+\/)?templates\/.+\.md$/, 'template', 70, 4000],
  [/^hooks\/.+\.(ts|sh)$/, 'hook', 50, 3000],
  [/^(factory|workflow-security|presets\/[^/]+)\.yaml$/, 'factory file', 60, 4000],
]

/** The one list of stack and language names the core layer must not name; `stacks/` may. */
export const STACK_TERMS = ['TypeScript', 'JavaScript', 'React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Laravel', 'PHP', 'Python', 'Django', 'Rails', 'Ruby', 'Java', 'Kotlin', 'Swift', 'Rust', 'Golang']

const TIERS = ['cheap', 'standard', 'strong']
const PACK_PATH = /(?<![\w/.<>-])((?:rules|skills|hooks|templates|roles|presets|stacks)\/[\w.-]+(?:\/[\w.-]+)*)/g
const LINK = /\]\((\.{1,2}\/[^)#\s]+)/g
const HOOK = /(?<![\w.-])hooks\/([\w-]+\.(?:ts|sh))/g
const ESCAPE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const walk = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(md|ya?ml|ts|sh)$/.test(e.name))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()

/** Avoid terms of two or more words and without a qualifier; single words are everyday English and stay with the reviewer. */
export const avoidTerms = (context: string): string[] =>
  context.split('\n').filter((l) => l.startsWith('_Avoid_:')).flatMap((l) => l.slice(8).split(/,(?![^(]*\))/))
    .map((t) => t.trim()).filter((t) => !t.includes('(') && /\s/.test(t))

/** The first `| Role | Tier |` table of the spec: role id to tier. */
export const specTiers = (spec: string): { tiers: Map<string, string>; line: number } | null => {
  const rows = spec.split('\n')
  const at = rows.findIndex((r) => /^\|\s*Role\s*\|\s*Tier\s*\|/.test(r))
  if (at < 0) return null
  const tiers = new Map<string, string>()
  for (let i = at + 2; i < rows.length && rows[i]!.startsWith('|'); i++) {
    const [role, tier] = rows[i]!.split('|').slice(1, 3).map((c) => c.trim())
    if (role && tier) tiers.set(role, tier)
  }
  return { tiers, line: at + 1 }
}

export function lintPack({ packDir, contextFile, specFile }: LintOpts): Finding[] {
  const out: Finding[] = []
  const add = (file: string, line: number, msg: string) => out.push({ file, line, msg })
  const files = walk(packDir)
  const text = new Map(files.map((f) => [f, readFileSync(join(packDir, f), 'utf8')]))
  const lines = (f: string) => text.get(f)!.split('\n')
  const read = (f: string): string | null => (existsSync(f) ? readFileSync(f, 'utf8') : null)
  const context = read(contextFile)
  const spec = read(specFile)

  // 1. size caps
  for (const f of files) {
    const cap = CAPS.find(([re]) => re.test(f))
    if (!cap) continue
    const [, kind, maxLines, maxBytes] = cap
    const n = text.get(f)!.replace(/\n$/, '').split('\n').length
    const bytes = Buffer.byteLength(text.get(f)!)
    if (n > maxLines) add(f, maxLines + 1, `The ${kind} has ${n} lines; the cap for a ${kind} is ${maxLines}. Split it or cut it.`)
    if (bytes > maxBytes) add(f, 1, `The ${kind} is ${bytes} bytes; the cap for a ${kind} is ${maxBytes}. Split it or cut it.`)
  }

  // 2. cited paths exist inside the pack; anything not rooted at a pack folder is a Product or runtime path and is not checked
  for (const f of files.filter((x) => /\.(md|ya?ml)$/.test(x))) {
    lines(f).forEach((l, i) => {
      for (const m of l.matchAll(PACK_PATH)) {
        const p = m[1]!.replace(/[.-]+$/, '')
        if (!existsSync(join(packDir, p))) add(f, i + 1, `It cites ${p}, which does not exist in the pack.`)
      }
      for (const m of l.matchAll(LINK)) {
        const abs = resolve(packDir, dirname(f), m[1]!)
        if (abs.startsWith(resolve(packDir) + sep) && !existsSync(abs)) add(f, i + 1, `It links ${m[1]}, which does not exist in the pack.`)
      }
    })
  }

  // 3. terms the glossary forbids
  if (!context) add(contextFile, 1, 'The glossary was not found, so its Avoid terms were not checked.')
  else {
    for (const term of avoidTerms(context)) {
      const re = new RegExp(`(?<![\\w-])${ESCAPE(term).replace(/\s+/g, '\\s+')}(?![\\w-])`, 'i')
      for (const f of files) lines(f).forEach((l, i) => re.test(l) && add(f, i + 1, `It uses "${term}", which ${contextFile} lists under Avoid.`))
    }
  }

  // 4. tiers equal the spec's Role | Tier table
  const table = spec ? specTiers(spec) : null
  if (!table) add(specFile, 1, 'The spec has no `| Role | Tier |` table, so the tiers of the factory file and the presets were not checked.')
  else {
    for (const f of files.filter((x) => x === 'factory.yaml' || /^presets\/.+\.yaml$/.test(x))) {
      const roles = (parse(text.get(f)!) as { team?: { roles?: Record<string, { tier?: string }> } })?.team?.roles ?? {}
      for (const [id, role] of Object.entries(roles)) {
        if (!role.tier) continue
        const line = lines(f).findIndex((l) => new RegExp(`^\\s*${id}:`).test(l)) + 1
        const want = table.tiers.get(id)
        if (!want) add(f, line, `Role ${id} is not in the tier table of ${specFile}.`)
        else if (want !== role.tier) add(f, line, `Role ${id} has tier ${role.tier}, but the tier table of ${specFile} says ${want}.`)
      }
    }
    for (const [id, tier] of table.tiers) if (!TIERS.includes(tier)) add(specFile, table.line, `The tier table gives ${id} the tier "${tier}"; it must be one of ${TIERS.join(', ')}.`)
  }

  // 5. no stack or language names in the core layer
  const stack = new RegExp(`(?<![\\w.])(${STACK_TERMS.map(ESCAPE).join('|')})(?![\\w])`, 'g')
  for (const f of files.filter((x) => !x.startsWith('stacks/'))) {
    lines(f).forEach((l, i) => { for (const m of l.matchAll(stack)) add(f, i + 1, `It names ${m[1]}; stack names belong under stacks/, not in the core pack.`) })
  }

  // 6. a rule that cites a hook as enforcement cites one that is implemented (a stub has a TODO or says "not active")
  const hooks = new Map(files.filter((f) => /^hooks\/[\w-]+\.(ts|sh)$/.test(f)).map((f) => [f.slice(6), /TODO|not active/i.test(text.get(f)!)]))
  const cites = [...files.filter((f) => !f.startsWith('hooks/') && f !== 'pack.yaml').map((f) => ({ file: f, body: text.get(f)! })), ...(spec ? [{ file: specFile, body: spec }] : [])]
  for (const { file, body } of cites) {
    body.split('\n').forEach((l, i) => {
      if (/not active|not enforced/i.test(l)) return
      for (const m of l.matchAll(HOOK)) {
        if (!hooks.has(m[1]!)) file === specFile && add(file, i + 1, `It cites hooks/${m[1]}, which does not exist.`) // pack files: check 2
        else if (hooks.get(m[1]!)) add(file, i + 1, `It cites hooks/${m[1]} as enforcement, but that hook is a stub (TODO or not active). Say what enforces it today.`)
      }
    })
  }

  return out.map((x) => (text.has(x.file) ? { ...x, file: join(packDir, x.file) } : x))
}

export const formatFindings = (findings: Finding[]): string => findings.map((f) => `${f.file}:${f.line}: ${f.msg}`).join('\n')
