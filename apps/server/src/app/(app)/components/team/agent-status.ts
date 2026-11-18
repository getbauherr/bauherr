import { durationHm } from '../../lib/format'
import type { SessionView } from '../../../../lib/sessions'

const mins = (from: string | null, to: number | string | null) => Math.max(1, Math.round(((typeof to === 'number' ? to : +new Date(to ?? 0)) - +new Date(from ?? 0)) / 6e4))
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const agentStatus = ({ session: s, ci }: Pick<SessionView, 'session' | 'ci'>, now = Date.now()): string => {
  const silent = `No signal for ${durationHm((now - +new Date(s.lastSeenAt ?? 0)) / 1000)}`
  switch (s.health) {
    case 'working':
      return ci ? `Waiting for CI ${ci.passed}/${ci.total}` : `${cap(s.activity ?? 'working')} #${s.ticket?.number}`
    case 'idle':
      return 'Idle, waiting for work'
    case 'stuck':
      return `Stuck: ${silent.toLowerCase()} while holding a Run`
    case 'not-responding':
      return `Not responding: ${silent.toLowerCase()}`
    case 'disconnected':
      return `Disconnected: ${s.endReason === 'timeout' ? `No signal for ${mins(s.lastSeenAt, s.disconnectedAt)} min.` : s.endReason === 'replaced' ? 'A newer session took its place.' : 'The agent ended the session.'}`
  }
}
