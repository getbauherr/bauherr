import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AGW_IMAGE, buildConfig } from './helpers/gateway-config'

it('the template with one entry per preset and both budget units passes agentgateway --validate-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agw-'))
  buildConfig(dir)
  const r = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/cfg:ro`, AGW_IMAGE, '--validate-only', '-f', '/cfg/config.yaml'], { encoding: 'utf8' })
  expect(r.status, r.stderr + r.stdout).toBe(0)
})
