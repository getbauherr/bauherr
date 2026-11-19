import { Badge } from '../ui/badge'
import { ago } from '../../lib/format'
import type { GatewayStatus as Status } from '../../lib/gateway-setup'

export function GatewayStatus({ status }: { status: Status }) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="gateway-status">
      <Badge variant={status.up ? 'ok' : status.up === null ? 'muted' : 'destructive'}>{status.up ? 'Gateway running' : status.up === null ? 'Not checked yet' : 'Gateway not reachable'}</Badge>
      {status.checkedAt && <span className="small text-muted-foreground">checked {ago(status.checkedAt)}</span>}
      {!status.up && status.message && <span className="small text-muted-foreground">{status.message}</span>}
    </div>
  )
}
