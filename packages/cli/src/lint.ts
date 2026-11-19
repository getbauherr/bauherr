import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type Finding = { file: string; line: number; msg: string }
export type LintOpts = { packDir: string; contextFile: string }

/** Per file kind: [path pattern, name, max lines, max bytes]. */
export const CAPS: [RegExp, string, number, number][] = [
  [/^(stacks\/[^/]+\/)?roles\/.+\.md$/, 'role profile', 40, 3000],
  [/^(stacks\/[^/]+\/)?rules\/.+\.md$/, 'rule', 60, 4000],
  [/^(stacks\/[^/]+\/)?skills\/.+\.md$/, 'skill file', 100, 6000],
  [/^(stacks\/[^/]+\/)?templates\/.+\.md$/, 'template', 70, 4000],
]

/** The one list of stack and language names the core layer must not name; `stacks/` may. */
export const STACK_TERMS = ['TypeScript', 'JavaScript', 'React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Laravel', 'PHP', 'Python', 'Django', 'Rails', 'Ruby', 'Java', 'Kotlin', 'Swift', 'Rust', 'Golang']

const PACK_PATH = /(?<![\w/.<>-])((?:rules|skills|hooks|templates|roles|presets|stacks)\/[\w.-]+(?:\/[\w.-]+)*)/g
const LINK = /\]\((\.{1,2}\/[^)#\s]+)/g
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

export function lintPack({ packDir, contextFile }: LintOpts): Finding[] {
  const out: Finding[] = []
  const add = (file: string, line: number, msg: string) => out.push({ file, line, msg })
  const files = walk(packDir)
  const text = new Map(files.map((f) => [f, readFileSync(join(packDir, f), 'utf8')]))
  const lines = (f: string) => text.get(f)!.split('\n')
  const read = (f: string): string | null => (existsSync(f) ? readFileSync(f, 'utf8') : null)
  const context = read(contextFile)

  for (const f of files) {
    const cap = CAPS.find(([re]) => re.test(f))
    if (!cap) continue
    const [, kind, maxLines, maxBytes] = cap
    const n = text.get(f)!.replace(/\n$/, '').split('\n').length
    const bytes = Buffer.byteLength(text.get(f)!)
    if (n > maxLines) add(f, maxLines + 1, `The ${kind} has ${n} lines; the cap for a ${kind} is ${maxLines}. Split it or cut it.`)
    if (bytes > maxBytes) add(f, 1, `The ${kind} is ${bytes} bytes; the cap for a ${kind} is ${maxBytes}. Split it or cut it.`)
  }

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

  if (!context) add(contextFile, 1, 'The glossary was not found, so its Avoid terms were not checked.')
  else {
    for (const term of avoidTerms(context)) {
      const re = new RegExp(`(?<![\\w-])${ESCAPE(term).replace(/\s+/g, '\\s+')}(?![\\w-])`, 'i')
      for (const f of files) lines(f).forEach((l, i) => re.test(l) && add(f, i + 1, `It uses "${term}", which ${contextFile} lists under Avoid.`))
    }
  }

  const stack = new RegExp(`(?<![\\w.])(${STACK_TERMS.map(ESCAPE).join('|')})(?![\\w])`, 'g')
  for (const f of files.filter((x) => !x.startsWith('stacks/'))) {
    lines(f).forEach((l, i) => { for (const m of l.matchAll(stack)) add(f, i + 1, `It names ${m[1]}; stack names belong under stacks/, not in the core pack.`) })
  }

  return out.map((x) => (text.has(x.file) ? { ...x, file: join(packDir, x.file) } : x))
}

export const formatFindings = (findings: Finding[]): string => findings.map((f) => `${f.file}:${f.line}: ${f.msg}`).join('\n')
