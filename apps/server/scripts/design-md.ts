import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

type Tok = { name: string; value: string | { light: string; dark: string } }
type Style = { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string }
type Tokens = {
  color: { tokens: Tok[] }
  type: { families: Record<string, string>; groups: { family: string; styles: Style[] }[] }
  spacing: { tokens: Tok[] }
  radius: { tokens: Tok[] }
  duration: { tokens: Tok[] }
  easing: { tokens: Tok[] }
}

const unquote = (v: string) => v.replaceAll('"', '')
const plain = (v: Tok['value']) => (typeof v === 'string' ? v : v.light)
const refOf = (v: string) => v.replace(/^\{(.+)\}$/, '{colors.$1}')

/** Rows of the first-column-backticked tables inside `heading`'s section: name -> cells (backticks stripped). */
function table(md: string, heading: string): Map<string, string[]> {
  const start = md.indexOf(`\n${heading}\n`)
  const rest = start < 0 ? '' : md.slice(start + heading.length + 2)
  const end = rest.search(/\n#{2,3} /)
  const rows = new Map<string, string[]>()
  for (const line of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replaceAll('`', ''))
    if (line.startsWith('|') && /^`[^`]+`/.test(line.split('|')[1]!.trim())) rows.set(cells[0]!, cells.slice(1))
  }
  return rows
}

/** Compares a table against expected name -> cells; every difference is one line. */
function diffTable(out: string[], path: string, got: Map<string, string[]>, want: Map<string, string[]>, columns: string[]) {
  for (const [name, cells] of want) {
    const row = got.get(name)
    if (!row) out.push(`${path}.${name}: expected a row, got none`)
    else columns.forEach((c, i) => row[i] !== cells[i] && out.push(`${path}.${name}.${c}: expected ${cells[i]}, got ${row[i]}`))
  }
  for (const name of got.keys()) if (!want.has(name)) out.push(`${path}.${name}: expected no row, got one`)
}

function diffMap(out: string[], path: string, got: Record<string, unknown> = {}, want: Record<string, string>) {
  for (const [k, v] of Object.entries(want)) if (String(got[k]) !== v) out.push(`${path}.${k}: expected ${v}, got ${got[k]}`)
  for (const k of Object.keys(got)) if (!(k in want)) out.push(`${path}.${k}: expected no token, got ${String(got[k])}`)
}

/** Differences between `tokens.json` and DESIGN.md (front matter, Colors/Layout/Motion tables, component references); empty when equal. */
export function diffDesign(tokens: Tokens, markdown: string): string[] {
  const out: string[] = []
  const md = markdown.replaceAll('\r\n', '\n')
  const front = md.match(/^---\n([\s\S]*?)\n---\n/)
  const fm = (front ? parse(front[1]!) : {}) as Record<string, Record<string, Record<string, unknown> | string>>
  const colors = tokens.color.tokens

  diffMap(out, 'colors', fm.colors as Record<string, string>, Object.fromEntries(colors.map((c) => [c.name, typeof c.value === 'string' ? refOf(c.value) : c.value.light])))
  diffMap(out, 'spacing', fm.spacing as Record<string, string>, Object.fromEntries(tokens.spacing.tokens.map((s) => [s.name, plain(s.value)])))
  diffMap(out, 'rounded', fm.rounded as Record<string, string>, Object.fromEntries(tokens.radius.tokens.map((r) => [r.name.replace(/^radius-/, ''), plain(r.value)])))

  // Extra properties on a style (fontFeature) are hand-edited and tolerated; the set of styles and the token-derived properties must match.
  const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => [s, g.family] as const))
  const typo = (fm.typography ?? {}) as Record<string, Record<string, unknown>>
  for (const [s, family] of styles) {
    for (const [k, v] of Object.entries({ fontFamily: tokens.type.families[family]!, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing })) {
      const got = typo[s.name]?.[k]
      const want = k === 'fontFamily' ? unquote(v as string) : v
      if ((got === undefined ? undefined : String(got)) !== (want === undefined ? undefined : String(want))) out.push(`typography.${s.name}.${k}: expected ${want}, got ${got}`)
    }
  }
  for (const name of Object.keys(typo)) if (!styles.some(([s]) => s.name === name)) out.push(`typography.${name}: expected no style, got one`)

  diffTable(out, 'table.colors', table(md, '## Colors'),
    new Map(colors.map((c) => [c.name, typeof c.value === 'string' ? [`= ${c.value.slice(1, -1)}`, `= ${c.value.slice(1, -1)}`] : [c.value.light, c.value.dark]])), ['light', 'dark'])
  diffTable(out, 'table.layout', table(md, '## Layout'), new Map(tokens.spacing.tokens.map((s) => [s.name, [plain(s.value)]])), ['value'])
  diffTable(out, 'table.motion', table(md, '### Motion'), new Map([...tokens.duration.tokens, ...tokens.easing.tokens].map((m) => [m.name, [plain(m.value)]])), ['value'])

  for (const [name, props] of Object.entries((fm.components ?? {}) as Record<string, Record<string, unknown>>)) {
    for (const [prop, value] of Object.entries(props)) {
      const ref = typeof value === 'string' && value.match(/^\{(\w+)\.([\w-]+)\}$/)
      if (ref && !(ref[2]! in ((fm[ref[1]!] as object | undefined) ?? {}))) out.push(`components.${name}.${prop}: expected a defined token, got ${value}`)
    }
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')
  const diffs = diffDesign(JSON.parse(read('docs/design/tokens.json')), read('DESIGN.md'))
  for (const d of diffs) console.error(d)
  if (diffs.length) process.exit(1)
  console.log('DESIGN.md matches docs/design/tokens.json')
}
