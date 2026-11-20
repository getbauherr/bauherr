export type Tone = 'ok' | 'warn' | 'muted'
type SetupInput = {
  repositories: unknown[]
  sources: unknown[]
  deploy: { stagingUrl: string; productionGate: boolean }
}

export function setupOf(p: SetupInput) {
  const { deploy: d } = p
  const entries: [id: string, label: string, done: boolean][] = [
    ['repository', 'Repository and tickets', p.repositories.length > 0 && p.sources.length > 0],
    ['staging', 'Staging', d.stagingUrl !== ''],
  ]
  const rows = entries.map(([id, label, done]) => ({
    id,
    label,
    word: done ? 'Done' : 'Needs setup',
    tone: done ? ('ok' as const) : ('warn' as const),
  }))
  return {
    rows,
    open: rows.filter((r) => r.word === 'Needs setup').length,
    production: d.productionGate ? 'On' : 'Off',
  }
}
