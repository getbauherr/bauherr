import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ago } from '../../lib/format'
import { UI_FORWARD, type GatewayStatus as Status } from '../../lib/gateway-setup'

/**
 * One line with the stored gateway status. An Admin gets "Open the gateway UI" (through the admin proxy, never the admin port) only while the gateway runs;
 * otherwise the line says what to do instead of linking to a dead page.
 */
export function GatewayStatus({ status, admin }: { status: Status; admin: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="gateway-status">
      <Badge variant={status.up ? 'ok' : status.up === null ? 'muted' : 'destructive'}>{status.up ? 'Gateway running' : status.up === null ? 'Not checked yet' : 'Gateway not reachable'}</Badge>
      {status.checkedAt && <span className="small text-muted-foreground">checked {ago(status.checkedAt)}</span>}
      {status.up && admin && status.uiUrl && <Button asChild variant="outline" size="sm"><a href={status.uiUrl} target="_blank" rel="noreferrer">Open the gateway UI</a></Button>}
      {status.up && admin && !status.uiUrl && <Button variant="outline" size="sm" disabled title="Not set up on this installation: see below">Open the gateway UI</Button>}
      {!status.up && status.message && <span className="small text-muted-foreground">{status.message}</span>}
      {status.up && admin && !status.uiUrl && (
        <details className="small w-full text-muted-foreground" data-testid="gateway-ui-howto">
          <summary className="cursor-pointer">How to open the gateway UI</summary>
          <p className="m-0 mt-2">The gateway UI has no sign-in, so its port is never published. Forward it to your machine only while you need it, then set <span className="mono">GATEWAY_UI_URL=http://127.0.0.1:15000/ui/</span> so this button opens it.</p>
          <pre className="mono m-0 mt-2 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap text-foreground">{UI_FORWARD}</pre>
          <p className="m-0 mt-2">The gateway settings, read-only, open here without that: <a className="text-primary" href="/-/gateway/config_dump" target="_blank" rel="noreferrer">gateway config</a>.</p>
        </details>
      )}
    </div>
  )
}
