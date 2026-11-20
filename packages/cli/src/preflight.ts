import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

export class CliError extends Error {}

export type Probe = (args: string[]) => { status: number | null; missing: boolean }

export const dockerProbe: Probe = (args) => {
  const r = spawnSync('docker', args, { stdio: 'ignore' })
  const missing = r.error !== undefined && 'code' in r.error && r.error.code === 'ENOENT'
  return { status: r.status, missing }
}

export const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const s = createServer()
    s.once('error', () => done(false))
    s.listen(port, () => s.close(() => done(true)))
  })

const checkDocker = (probe: Probe): void => {
  if (probe(['--version']).missing)
    throw new CliError('Docker is not installed or not on PATH. Install Docker: https://docs.docker.com/get-docker/')
  if (probe(['info']).status !== 0)
    throw new CliError('The Docker daemon is not reachable. Start Docker (Desktop) and retry.')
  if (probe(['compose', 'version']).status !== 0)
    throw new CliError(
      'Docker Compose v2 is missing. Install the compose plugin: https://docs.docker.com/compose/install/',
    )
}

/**
 * Throws a CliError before anything is written when Docker, Compose or the port is unusable. `skipPort` is set when
 * this install's own stack already holds the port.
 */
export const preflight = async (
  port: number,
  {
    probe = dockerProbe,
    free = portFree,
    skipPort = false,
    gatewayPort,
  }: { probe?: Probe; free?: (port: number) => Promise<boolean>; skipPort?: boolean; gatewayPort?: number } = {},
): Promise<void> => {
  checkDocker(probe)
  if (skipPort) return
  if (!(await free(port))) throw new CliError(`Port ${port} is already in use. Pick another with --port.`)
  if (gatewayPort !== undefined && !(await free(gatewayPort)))
    throw new CliError(`Port ${gatewayPort} is already in use. Pick another with --gateway-port.`)
}
