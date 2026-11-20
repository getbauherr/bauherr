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
  pack lint  check a pack: pack lint [--pack pack] [--context CONTEXT.md]; exit 1 on findings

Options: --dir <path> (default ./bauherr)  --port <n>  --gateway-port <n> (default 4000, loopback)  --url <public url>\
  --yes  --volumes
         --anthropic-key-file <path>  --admin-password-file <path>  (seed)
`

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
  const [cmd, ...a] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  spawnSync(cmd, a, { stdio: 'ignore' })
}

type Opts = {
  dir: string
  port?: string | undefined
  gatewayPort?: string | undefined
  url?: string | undefined
  yes: boolean
}

const validPort = (p: string) => {
  if (!/^\d+$/.test(p) || +p < 1 || +p > 65535) throw new CliError(`Invalid port: ${p}`)
}

type Chosen = { port: string; gatewayPort: string; publicUrl: string }

const pick = (yes: boolean, question: string, def: string) => (yes ? def : ask(question, def))

const chooseSettings = async ({ dir, port, gatewayPort, url, yes }: Opts): Promise<Chosen> => {
  const old = readEnv(dir)
  const chosenPort = await pick(yes, 'Port', port ?? old.get('PORT') ?? '3000')
  validPort(chosenPort)
  const chosenGw = await pick(
    yes,
    'Gateway port (loopback, for session cost)',
    gatewayPort ?? old.get('GATEWAY_PORT') ?? '4000',
  )
  validPort(chosenGw)
  if (chosenGw === chosenPort) throw new CliError('--port and --gateway-port must differ')
  const defUrl = url ?? old.get('PUBLIC_URL') ?? `http://localhost:${chosenPort}`
  const publicUrl = await pick(yes, 'Public URL (localhost = polling mode, a public URL enables webhooks)', defUrl)
  return { port: chosenPort, gatewayPort: chosenGw, publicUrl }
}

const ownStackRunning = (dir: string) =>
  existsSync(join(dir, 'compose.yaml')) &&
  spawnSync('docker', ['compose', '--project-directory', dir, 'ps', '-q', 'app'], { encoding: 'utf8' }).stdout?.trim()

const init = async (opts: Opts) => {
  const { dir, yes } = opts
  const { port, gatewayPort, publicUrl } = await chooseSettings(opts)
  await preflight(+port, { skipPort: !!ownStackRunning(dir), gatewayPort: +gatewayPort })
  writeProject(dir, cliVersion(), { PORT: port, GATEWAY_PORT: gatewayPort, PUBLIC_URL: publicUrl })
  compose(dir, ['up', '-d', '--wait'])
  console.log(`\nBauherr ${cliVersion()} is running: ${publicUrl}\nFiles and secrets: ${dir} (env file mode 600)`)
  if (!yes) open(publicUrl)
}

const seedMounts = {
  'anthropic-key-file': ['ANTHROPIC_API_KEY_FILE', '/run/anthropic-key'],
  'admin-password-file': ['BAUHERR_ADMIN_PASSWORD_FILE', '/run/admin-password'],
} as const

const seed = (dir: string, files: Partial<Record<keyof typeof seedMounts, string>>) => {
  const mounts = (Object.keys(seedMounts) as (keyof typeof seedMounts)[]).flatMap((flag) => {
    const file = files[flag]
    return file
      ? ['-v', `${resolve(file)}:${seedMounts[flag][1]}:ro`, '-e', `${seedMounts[flag][0]}=${seedMounts[flag][1]}`]
      : []
  })
  compose(dir, [
    'run',
    '--rm',
    '--no-deps',
    '-T',
    ...mounts,
    '-e',
    'BAUHERR_ADMIN_EMAIL',
    '-e',
    'GITHUB_TOKEN',
    'app',
    'sh',
    '-c',
    'cd /repo/apps/server && pnpm seed',
  ])
}

const packLint = (positionals: string[], pack: string, context: string) => {
  if (positionals[1] !== 'lint') throw new CliError(`Unknown command: pack ${positionals[1] ?? ''}\n\n${usage}`)
  const findings = lintPack({ packDir: resolve(pack), contextFile: context })
  if (findings.length) {
    const shown = findings.map((f) => ({ ...f, file: relative(process.cwd(), f.file) || f.file }))
    throw new CliError(`pack lint: ${findings.length} finding(s)\n${formatFindings(shown)}`)
  }
  return console.log('pack lint: ok')
}

const parse = () =>
  parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string', default: 'bauherr' },
      port: { type: 'string' },
      'gateway-port': { type: 'string' },
      url: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      volumes: { type: 'boolean', default: false },
      'anthropic-key-file': { type: 'string' },
      'admin-password-file': { type: 'string' },
      pack: { type: 'string', default: 'pack' },
      context: { type: 'string', default: 'CONTEXT.md' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })

const installedCommand = (cmd: string, opts: Opts, values: ReturnType<typeof parse>['values']) => {
  const { dir } = opts
  const installed = existsSync(join(dir, 'compose.yaml'))
  if (cmd === 'up' && !installed) return init({ ...opts, yes: true })
  if (!['up', 'down', 'status', 'seed'].includes(cmd)) throw new CliError(`Unknown command: ${cmd}\n\n${usage}`)
  if (!installed) throw new CliError(`No Bauherr install in ${dir}. Run: npx bauherr init --dir ${values.dir}`)
  if (cmd === 'up') return compose(dir, ['up', '-d', '--wait'])
  if (cmd === 'down') return compose(dir, values.volumes ? ['down', '-v'] : ['down'])
  if (cmd === 'status') return compose(dir, ['ps'])
  return seed(dir, values)
}

const main = async () => {
  const { values, positionals } = parse()
  const dir = resolve(values.dir)
  const opts: Opts = { dir, port: values.port, gatewayPort: values['gateway-port'], url: values.url, yes: values.yes }
  const [cmd] = positionals
  if (values.version) return console.log(cliVersion())
  if (values.help || !cmd) return console.log(usage)
  if (cmd === 'init') return init(opts)
  if (cmd === 'pack') return packLint(positionals, values.pack, values.context)
  return installedCommand(cmd, opts, values)
}

main().catch((e) => {
  if (!(e instanceof CliError)) throw e
  console.error(`bauherr: ${e.message}`)
  process.exit(1)
})
