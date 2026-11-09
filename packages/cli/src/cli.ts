#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { CliError, preflight } from './preflight.js'
import { cliVersion, readEnv, writeProject } from './render.js'

const usage = `bauherr ${cliVersion()}

Usage: bauherr <command> [options]

  init     write compose.yaml and the env file, start the stack, print the URL
  up       start an installed stack (runs init --yes when nothing is installed)
  down     stop it (--volumes also deletes its data)
  status   show service state
  eval     run the evals of pack skills through the gateway (needs BAUHERR_GATEWAY_URL, BAUHERR_GATEWAY_KEY)
  seed     create the Admin user and first Workspace (needs BAUHERR_ADMIN_EMAIL, GITHUB_TOKEN)

Options: --dir <path> (default ./bauherr)  --port <n>  --url <public url>  --yes  --volumes
         --anthropic-key-file <path>  --admin-password-file <path>  (seed)
eval:    --skills <dir> (default pack/skills)  --skill <name> (repeatable)  --changed-vs <git ref>  --model <subject>  --judge-model <judge>
         --baseline <eval-results.json>  --out <file>  --summary <file>  --case-threshold 0.8  --suite-threshold 0.9  --max-cases 40  --max-usd 2`

type EvalRow = { id: string; pass: boolean; score: number; costUsd: number }
type EvalModule = {
  runEval: (o: Record<string, unknown>) => Promise<{ rows: EvalRow[]; passRate: number; ok: boolean; regressions: string[]; costUsd: number; aborted: boolean }>
  loadCases: (dir: string) => unknown[]
}

/** The runner is a private workspace package, resolved at run time so the published CLI does not depend on it. */
const evalSpecifier = '@bauherr/eval'
const loadEval = async (): Promise<EvalModule> => {
  try {
    return (await import(evalSpecifier)) as EvalModule
  } catch {
    throw new CliError('The eval runner is not part of this build of bauherr yet. Run it from a repo checkout (pnpm build:packages).')
  }
}

type EvalFlags = Record<'skills' | 'model' | 'judge-model', string> & Partial<Record<'changed-vs' | 'baseline' | 'out' | 'summary' | 'case-threshold' | 'suite-threshold' | 'max-cases' | 'max-usd', string>> & { skill?: string[] | undefined }

const num = (f: EvalFlags, name: keyof EvalFlags): number | undefined => {
  const v = f[name] as string | undefined
  if (v === undefined) return undefined
  if (!Number.isFinite(+v)) throw new CliError(`--${name} needs a number`)
  return +v
}

const evalSkills = async (f: EvalFlags) => {
  const { runEval, loadCases } = await loadEval()
  const root = resolve(f.skills)
  let names = f.skill ?? readdirSync(root).sort()
  if (f['changed-vs']) {
    const diff = spawnSync('git', ['diff', '--name-only', `${f['changed-vs']}...HEAD`], { encoding: 'utf8' })
    if (diff.status !== 0) throw new CliError(`git diff ${f['changed-vs']} failed`)
    const changed = diff.stdout.split('\n').filter(Boolean).map((l) => resolve(l))
    names = names.filter((n) => changed.some((c) => c.startsWith(`${join(root, n)}/`)))
  }
  const prior = f.baseline && existsSync(f.baseline) ? (JSON.parse(readFileSync(f.baseline, 'utf8')) as EvalRow[]) : undefined
  const rows: EvalRow[] = []
  const lines = ['| case | result | score | cost |', '|---|---|---|---|']
  let ok = true
  let cost = 0
  for (const name of names) {
    const evals = join(root, name, 'evals')
    if (!existsSync(evals)) continue
    const res = await runEval({
      skill: readFileSync(join(root, name, 'SKILL.md'), 'utf8'), packDir: dirname(root), cases: loadCases(evals),
      subject: { model: f.model }, judge: { model: f['judge-model'] },
      ...pick({ caseThreshold: num(f, 'case-threshold'), suiteThreshold: num(f, 'suite-threshold'), maxCases: num(f, 'max-cases'), maxUsd: num(f, 'max-usd') }),
      ...(prior ? { baseline: prior.filter((r) => r.id.startsWith(`${name}/`)).map((r) => ({ ...r, id: r.id.slice(name.length + 1) })) } : {}),
      ...(process.env.BAUHERR_EVAL_RUN ? { runLabel: process.env.BAUHERR_EVAL_RUN } : {}),
    })
    ok &&= res.ok
    cost += res.costUsd
    for (const r of res.rows) {
      rows.push({ ...r, id: `${name}/${r.id}` })
      lines.push(`| ${name}/${r.id} | ${r.pass ? 'pass' : 'FAIL'} | ${r.score.toFixed(2)} | $${r.costUsd.toFixed(4)} |`)
    }
    lines.push(`\n${name}: pass rate ${res.passRate.toFixed(2)} ${res.ok ? 'ok' : 'FAILED'}${res.aborted ? ' (aborted: max-usd)' : ''}${res.regressions.length ? ` (regressions: ${res.regressions.join(', ')})` : ''}\n`)
  }
  lines.push(`Total cost $${cost.toFixed(4)}`)
  if (f.out) writeFileSync(f.out, JSON.stringify(rows, null, 2))
  if (f.summary) appendFileSync(f.summary, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
  if (!ok) throw new CliError('eval failed')
}

const pick = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }

const compose = (dir: string, args: string[]) => {
  const r = spawnSync('docker', ['compose', '--project-directory', dir, ...args], { stdio: 'inherit' })
  if (r.status !== 0) throw new CliError(`docker compose ${args[0]} failed (exit ${r.status ?? 'signal'})`)
}

const ask = async (q: string, def: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(`${q} [${def}] `)).trim()
  rl.close()
  return a || def
}

const open = (url: string) => {
  const [cmd, ...a] = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
  spawnSync(cmd!, a, { stdio: 'ignore' })
}

type Opts = { dir: string; port?: string | undefined; url?: string | undefined; yes: boolean }

const init = async ({ dir, port, url, yes }: Opts) => {
  const old = readEnv(dir)
  const defPort = port ?? old.get('PORT') ?? '3000'
  const chosenPort = yes ? defPort : await ask('Port', defPort)
  if (!/^\d+$/.test(chosenPort) || +chosenPort < 1 || +chosenPort > 65535) throw new CliError(`Invalid port: ${chosenPort}`)
  const defUrl = url ?? old.get('PUBLIC_URL') ?? `http://localhost:${chosenPort}`
  const publicUrl = yes ? defUrl : await ask('Public URL (localhost = polling mode, a public URL enables webhooks)', defUrl)
  const own = existsSync(join(dir, 'compose.yaml')) && spawnSync('docker', ['compose', '--project-directory', dir, 'ps', '-q', 'app'], { encoding: 'utf8' }).stdout?.trim()
  await preflight(+chosenPort, { skipPort: !!own })
  writeProject(dir, cliVersion(), { PORT: chosenPort, PUBLIC_URL: publicUrl })
  compose(dir, ['up', '-d', '--wait'])
  console.log(`\nBauherr ${cliVersion()} is running: ${publicUrl}\nFiles and secrets: ${dir} (env file mode 600)`)
  if (!yes) open(publicUrl)
}

const seedMounts = { 'anthropic-key-file': ['ANTHROPIC_API_KEY_FILE', '/run/anthropic-key'], 'admin-password-file': ['BAUHERR_ADMIN_PASSWORD_FILE', '/run/admin-password'] } as const

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: 'bauherr' }, port: { type: 'string' }, url: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false }, volumes: { type: 'boolean', default: false },
      'anthropic-key-file': { type: 'string' }, 'admin-password-file': { type: 'string' },
      skills: { type: 'string', default: 'pack/skills' }, skill: { type: 'string', multiple: true }, 'changed-vs': { type: 'string' },
      model: { type: 'string', default: 'cheap-default' }, 'judge-model': { type: 'string', default: 'judge-default' }, baseline: { type: 'string' },
      out: { type: 'string' }, summary: { type: 'string' }, 'case-threshold': { type: 'string' }, 'suite-threshold': { type: 'string' }, 'max-cases': { type: 'string' }, 'max-usd': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false }, version: { type: 'boolean', short: 'v', default: false },
    },
  })
  const dir = resolve(values.dir)
  const opts: Opts = { dir, port: values.port, url: values.url, yes: values.yes }
  const [cmd] = positionals
  if (values.version) return console.log(cliVersion())
  if (values.help || !cmd) return console.log(usage)
  if (cmd === 'init') return init(opts)
  if (cmd === 'eval') return evalSkills(values)
  const installed = existsSync(join(dir, 'compose.yaml'))
  if (cmd === 'up' && !installed) return init({ ...opts, yes: true })
  if (!['up', 'down', 'status', 'seed'].includes(cmd)) throw new CliError(`Unknown command: ${cmd}\n\n${usage}`)
  if (!installed) throw new CliError(`No Bauherr install in ${dir}. Run: npx bauherr init --dir ${values.dir}`)
  if (cmd === 'up') return compose(dir, ['up', '-d', '--wait'])
  if (cmd === 'down') return compose(dir, values.volumes ? ['down', '-v'] : ['down'])
  if (cmd === 'status') return compose(dir, ['ps'])
  const mounts = (Object.keys(seedMounts) as (keyof typeof seedMounts)[]).flatMap((flag) => {
    const file = values[flag]
    return file ? ['-v', `${resolve(file)}:${seedMounts[flag][1]}:ro`, '-e', `${seedMounts[flag][0]}=${seedMounts[flag][1]}`] : []
  })
  compose(dir, ['run', '--rm', '--no-deps', '-T', ...mounts, '-e', 'BAUHERR_ADMIN_EMAIL', '-e', 'GITHUB_TOKEN', 'app', 'sh', '-c', 'cd /repo/apps/server && pnpm seed'])
}

main().catch((e) => {
  if (!(e instanceof CliError)) throw e
  console.error(`bauherr: ${e.message}`)
  process.exit(1)
})
