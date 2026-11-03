import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { buildWidget } from '../scripts/build-widget'

const BUDGET_KB = 250

it(`the embeddable widget bundle stays within ${BUDGET_KB} KB gzip`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'widget-'))
  try {
    const file = join(dir, 'widget.js')
    await buildWidget(file)
    const js = readFileSync(file, 'utf8')
    expect(js).toContain('attachShadow')
    const kb = gzipSync(js).length / 1024
    expect(kb, `widget.js is ${kb.toFixed(1)} KB gzip`).toBeLessThanOrEqual(BUDGET_KB)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
