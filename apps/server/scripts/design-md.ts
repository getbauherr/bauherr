import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import { parseTokens, type Tok, type Tokens } from './design-tokens'

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()])
const tokenMap = z.record(z.string(), primitive)
const frontmatterSchema = z.looseObject({
  colors: tokenMap.optional(),
  spacing: tokenMap.optional(),
  rounded: tokenMap.optional(),
  typography: z.record(z.string(), tokenMap).optional(),
  components: z.record(z.string(), tokenMap).optional(),
})
type TokenMap = z.infer<typeof tokenMap>
type Frontmatter = z.infer<typeof frontmatterSchema>

const unquote = (v: string) => v.replaceAll('"', '')
const plain = (v: Tok['value']) => (typeof v === 'string' ? v : v.light)
const refOf = (v: string) => v.replace(/^\{(.+)\}$/, '{colors.$1}')

function table(md: string, heading: string): Map<string, string[]> {
  const start = md.indexOf(`\n${heading}\n`)
  const rest = start < 0 ? '' : md.slice(start + heading.length + 2)
  const end = rest.search(/\n#{2,3} /)
  const rows = new Map<string, string[]>()
  for (const line of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replaceAll('`', ''))
    if (line.startsWith('|') && /^`[^`]+`/.test(line.split('|')[1].trim())) rows.set(cells[0], cells.slice(1))
  }
  return rows
}

function diffTable(
  out: string[],
  path: string,
  got: Map<string, string[]>,
  want: Map<string, string[]>,
  columns: string[],
) {
  for (const [name, cells] of want) {
    const row = got.get(name)
    if (!row) out.push(`${path}.${name}: expected a row, got none`)
    else
      columns.forEach(
        (c, i) => row[i] !== cells[i] && out.push(`${path}.${name}.${c}: expected ${cells[i]}, got ${row[i]}`),
      )
  }
  for (const name of got.keys()) if (!want.has(name)) out.push(`${path}.${name}: expected no row, got one`)
}

function diffMap(out: string[], path: string, got: TokenMap = {}, want: Record<string, string>) {
  for (const [k, v] of Object.entries(want))
    if (String(got[k]) !== v) out.push(`${path}.${k}: expected ${v}, got ${got[k]}`)
  for (const k of Object.keys(got)) if (!(k in want)) out.push(`${path}.${k}: expected no token, got ${String(got[k])}`)
}

function diffTokenMaps(out: string[], fm: Frontmatter, tokens: Tokens) {
  diffMap(
    out,
    'colors',
    fm.colors,
    Object.fromEntries(
      tokens.color.tokens.map((c) => [c.name, typeof c.value === 'string' ? refOf(c.value) : c.value.light]),
    ),
  )
  diffMap(out, 'spacing', fm.spacing, Object.fromEntries(tokens.spacing.tokens.map((s) => [s.name, plain(s.value)])))
  diffMap(
    out,
    'rounded',
    fm.rounded,
    Object.fromEntries(tokens.radius.tokens.map((r) => [r.name.replace(/^radius-/, ''), plain(r.value)])),
  )
}

const optionalString = (v: z.infer<typeof primitive> | undefined) => (v === undefined ? undefined : String(v))

function diffTypography(out: string[], fm: Frontmatter, tokens: Tokens) {
  const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => [s, g.family] as const))
  const typo = fm.typography ?? {}
  for (const [s, family] of styles) {
    for (const [k, v] of Object.entries({
      fontFamily: tokens.type.families[family],
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
    })) {
      const got = typo[s.name]?.[k]
      const want = k === 'fontFamily' ? unquote(v as string) : v
      if (optionalString(got) !== optionalString(want))
        out.push(`typography.${s.name}.${k}: expected ${want}, got ${got}`)
    }
  }
  for (const name of Object.keys(typo))
    if (!styles.some(([s]) => s.name === name)) out.push(`typography.${name}: expected no style, got one`)
}

function diffTables(out: string[], md: string, tokens: Tokens) {
  diffTable(
    out,
    'table.colors',
    table(md, '## Colors'),
    new Map(
      tokens.color.tokens.map((c) => [
        c.name,
        typeof c.value === 'string'
          ? [`= ${c.value.slice(1, -1)}`, `= ${c.value.slice(1, -1)}`]
          : [c.value.light, c.value.dark],
      ]),
    ),
    ['light', 'dark'],
  )
  diffTable(
    out,
    'table.layout',
    table(md, '## Layout'),
    new Map(tokens.spacing.tokens.map((s) => [s.name, [plain(s.value)]])),
    ['value'],
  )
  diffTable(
    out,
    'table.motion',
    table(md, '### Motion'),
    new Map([...tokens.duration.tokens, ...tokens.easing.tokens].map((m) => [m.name, [plain(m.value)]])),
    ['value'],
  )
}

const sectionOf = (fm: Frontmatter, name: string): object => {
  const section = fm[name]
  return typeof section === 'object' && section !== null ? section : {}
}

function diffComponents(out: string[], fm: Frontmatter) {
  for (const [name, props] of Object.entries(fm.components ?? {})) {
    for (const [prop, value] of Object.entries(props)) {
      const ref = typeof value === 'string' && value.match(/^\{(\w+)\.([\w-]+)\}$/)
      if (ref && !(ref[2] in sectionOf(fm, ref[1])))
        out.push(`components.${name}.${prop}: expected a defined token, got ${value}`)
    }
  }
}

export function diffDesign(tokens: Tokens, markdown: string): string[] {
  const out: string[] = []
  const md = markdown.replaceAll('\r\n', '\n')
  const front = md.match(/^---\n([\s\S]*?)\n---\n/)
  const fm = frontmatterSchema.parse(front ? parse(front[1]) : {})
  diffTokenMaps(out, fm, tokens)
  diffTypography(out, fm, tokens)
  diffTables(out, md, tokens)
  diffComponents(out, fm)
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')
  const diffs = diffDesign(parseTokens(read('docs/design/tokens.json')), read('DESIGN.md'))
  for (const d of diffs) console.error(d)
  if (diffs.length) process.exit(1)
  console.log('DESIGN.md matches docs/design/tokens.json')
}
