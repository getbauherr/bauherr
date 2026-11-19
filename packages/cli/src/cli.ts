#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { formatFindings, lintPack } from './lint.js'
import { CliError, preflight } from './preflight.js'
import { cliVersion, readEnv, writeProject } from './render.js'

const usage = `bauherr ${cliVersion()}

Usage: bauherr <command> [options]

  init     write compose.yaml and the env file, start the stack, print the URL
  up       start an installed stack (runs init --yes when nothing is installed)
  down     stop it (--volumes also deletes its data)
  status   show service state
  seed     create the Admin user and first Workspace (needs BAUHERR_ADMIN_EMAIL, GITHUB_TOKEN)
  pack lint  check a pack: pack lint [--pack pack] [--context CONTEXT.md] [--spec docs/spec/workflow.md]; exit 1 on findings

Options: --dir <path> (default ./bauherr)  --port <n>  --gateway-port <n> (default 4000, loopback)  --url <public url>  --yes  --volumes
         --anthropic-key-file <path>  --admin-password-file <path>  (seed)
`

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

type Opts = { dir: string; port?: string | undefined; gatewayPort?: string | undefined; url?: string | undefined; yes: boolean }

const validPort = (p: string) => {
  if (!/^\d+$/.test(p) || +p < 1 || +p > 65535) throw new CliError(`Invalid port: ${p}`)
}

const init = async ({ dir, port, gatewayPort, url, yes }: Opts) => {
  const old = readEnv(dir)
  const defPort = port ?? old.get('PORT') ?? '3000'
  const chosenPort = yes ? defPort : await ask('Port', defPort)
  validPort(chosenPort)
  const defGw = gatewayPort ?? old.get('GATEWAY_PORT') ?? '4000'
  const chosenGw = yes ? defGw : await ask('Gateway port (loopback, for session cost)', defGw)
  validPort(chosenGw)
  if (chosenGw === chosenPort) throw new CliError('--port and --gateway-port must differ')
  const defUrl = url ?? old.get('PUBLIC_URL') ?? `http://localhost:${chosenPort}`
  const publicUrl = yes ? defUrl : await ask('Public URL (localhost = polling mode, a public URL enables webhooks)', defUrl)
  const own = existsSync(join(dir, 'compose.yaml')) && spawnSync('docker', ['compose', '--project-directory', dir, 'ps', '-q', 'app'], { encoding: 'utf8' }).stdout?.trim()
  await preflight(+chosenPort, { skipPort: !!own, gatewayPort: +chosenGw })
  writeProject(dir, cliVersion(), { PORT: chosenPort, GATEWAY_PORT: chosenGw, PUBLIC_URL: publicUrl })
  compose(dir, ['up', '-d', '--wait'])
  console.log(`\nBauherr ${cliVersion()} is running: ${publicUrl}\nFiles and secrets: ${dir} (env file mode 600)`)
  if (!yes) open(publicUrl)
}

const seedMounts = { 'anthropic-key-file': ['ANTHROPIC_API_KEY_FILE', '/run/anthropic-key'], 'admin-password-file': ['BAUHERR_ADMIN_PASSWORD_FILE', '/run/admin-password'] } as const

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: 'bauherr' }, port: { type: 'string' }, 'gateway-port': { type: 'string' }, url: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false }, volumes: { type: 'boolean', default: false },
      'anthropic-key-file': { type: 'string' }, 'admin-password-file': { type: 'string' },
      pack: { type: 'string', default: 'pack' }, context: { type: 'string', default: 'CONTEXT.md' }, spec: { type: 'string', default: 'docs/spec/workflow.md' },
      help: { type: 'boolean', short: 'h', default: false }, version: { type: 'boolean', short: 'v', default: false },
    },
  })
  const dir = resolve(values.dir)
  const opts: Opts = { dir, port: values.port, gatewayPort: values['gateway-port'], url: values.url, yes: values.yes }
  const [cmd] = positionals
  if (values.version) return console.log(cliVersion())
  if (values.help || !cmd) return console.log(usage)
  if (cmd === 'init') return init(opts)
  if (cmd === 'pack') {
    if (positionals[1] !== 'lint') throw new CliError(`Unknown command: pack ${positionals[1] ?? ''}\n\n${usage}`)
    const findings = lintPack({ packDir: resolve(values.pack), contextFile: values.context, specFile: values.spec })
    if (findings.length) throw new CliError(`pack lint: ${findings.length} finding(s)\n${formatFindings(findings.map((f) => ({ ...f, file: relative(process.cwd(), f.file) || f.file })))}`)
    return console.log('pack lint: ok')
  }
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
