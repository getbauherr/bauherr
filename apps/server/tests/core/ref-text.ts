import { appendEvent, readRecord } from '../../src/core/record/store'
import type { Engine } from './harness'
import { edit } from './scenario'

export const REFERENCING_TITLE = 'Result to read'

export const referencing = async (e: Engine, ids: { result: number; target: number }) => {
  const { payload } = e.db
  const { source } = (await readRecord(payload, ids.target)).record
  const mention = `#${source.number}`
  const { record } = await readRecord(payload, ids.result)
  const findings = record.findings.map((finding, index) =>
    index === 0 ? { ...finding, text: `${finding.text} Same as ${mention}.` } : finding,
  )
  await edit(e, ids.result, 'verify', { findings })
  await appendEvent(payload, ids.result, {
    type: 'owner.note',
    data: { note: `Compare with ${mention}.` },
    actor: 'owner',
  })
}
