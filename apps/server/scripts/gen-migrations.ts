import { readdirSync, writeFileSync } from 'node:fs'

const dir = new URL('../src/migrations/', import.meta.url)
const NAME = /^(\d{8}_\d{6}_[a-z0-9_]+)\.ts$/

/** Migration names (file stems) sorted by name; throws on a file that breaks the `YYYYMMDD_HHMMSS_slug.ts` convention. `index.ts` is the generated output and skipped. */
export function migrationNames(files: string[]): string[] {
  const names = files.filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => {
    const m = NAME.exec(f)
    if (!m) throw new Error(`migration file name must match YYYYMMDD_HHMMSS_slug.ts: ${f}`)
    return m[1]
  })
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) throw new Error(`duplicate migration name: ${dup}`)
  return names.sort()
}

/** Source of `src/migrations/index.ts` (git-ignored; Payload's `prodMigrations` and `payload migrate` read it). */
export function renderMigrations(names: string[]): string {
  const imports = names.map((n) => `import * as migration_${n} from './${n}';`).join('\n')
  const entries = names.map((n) => `  {\n    up: migration_${n}.up,\n    down: migration_${n}.down,\n    name: '${n}'\n  }`).join(',\n')
  return `${imports}\n\nexport const migrations = [\n${entries}\n];\n`
}

if (process.argv[1] === new URL(import.meta.url).pathname) writeFileSync(new URL('index.ts', dir), renderMigrations(migrationNames(readdirSync(dir))))
