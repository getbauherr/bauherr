import Link from 'next/link'
import { KIND_LABEL } from '../../../lib/intake/kinds'
import type { Kind } from '../../../lib/intake/engine'
import type { Need } from '../../../lib/needs-you'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import type { Waits } from '../lib/requests'

/** The type chip of a request or Ticket (nothing for one that has no type). */
export const KindChip = ({ kind }: { kind: Kind | null }) => (kind ? <Badge variant="neutral" data-testid="kind-chip">{KIND_LABEL[kind]}</Badge> : null)

/** "Urgent" while it is asked for, "Fast lane" while the Ticket is on it. */
export const LaneChip = ({ urgent, lane }: { urgent?: boolean; lane?: 'proposed' | 'fast' | null }) =>
  lane === 'fast' ? <Badge variant="destructive" data-testid="lane-chip">Fast lane</Badge> : urgent || lane === 'proposed' ? <Badge variant="destructive" data-testid="urgent-chip">Urgent</Badge> : null

/** The plain status and who it waits for ("Being built · The factory"). */
export const StatusLine = ({ status, waits }: { status: string; waits: Waits | null }) => (
  <span className="small" data-testid="request-status">{status}{waits && <span className="text-muted-foreground"> · waits for {waits === 'You' ? 'you' : waits.replace(/^The /, 'the ')}</span>}</span>
)

/** The one primary action of a request that needs the viewer: questions open the refinement panel on the Ticket page, the rest the Inbox card. */
export function NeedButton({ ticket, need }: { ticket: number; need: Need }) {
  if (need === 'Answer questions' || need === 'Answer decisions') return <Button asChild size="sm"><Link href={`/tickets/${ticket}?view=conversation`}>{need}</Link></Button>
  const label = need === 'Accept on staging' ? 'Test and accept' : need === 'Expedite?' ? 'Decide on the fast lane' : need
  return <Button asChild size="sm"><Link href={`/inbox#t${ticket}`}>{label}</Link></Button>
}
