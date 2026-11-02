import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

export class CliError extends Error {}

export type Probe = (args: string[]) => { status: number | null; missing: boolean }

export const dockerProbe: Probe = (args) => {
  const r = spawnSync('docker', args, { stdio: 'ignore' })
  return { status: r.status, missing: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' }
}

export const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const s = createServer()
    s.once('error', () => done(false))
    s.listen(port, () => s.close(() => done(true)))
  })

/** Throws a CliError before anything is written when Docker, Compose or the port is unusable. `skipPort` is set when this install's own stack already holds the port. */
export const preflight = async (port: number, { probe = dockerProbe, free = portFree, skipPort = false } = {}): Promise<void> => {
  if (probe(['--version']).missing) throw new CliError('Docker is not installed or not on PATH. Install Docker: https://docs.docker.com/get-docker/')
  if (probe(['info']).status !== 0) throw new CliError('The Docker daemon is not reachable. Start Docker (Desktop) and retry.')
  if (probe(['compose', 'version']).status !== 0) throw new CliError('Docker Compose v2 is missing. Install the compose plugin: https://docs.docker.com/compose/install/')
  if (!skipPort && !(await free(port))) throw new CliError(`Port ${port} is already in use. Pick another with --port.`)
}
