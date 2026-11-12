import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ago } from '../../lib/format'
import { UI_SWITCH_ON, type GatewayStatus as Status } from '../../lib/gateway-setup'

/**
 * One line with the stored gateway status. An Admin gets "Open the gateway UI" only while the gateway runs and its UI is switched on (`GATEWAY_UI_URL`, compose profile `gateway-ui`);
 * while it is off the line says how to switch it on instead of linking to a dead page.
 */
export function GatewayStatus({ status, admin }: { status: Status; admin: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="gateway-status">
      <Badge variant={status.up ? 'ok' : status.up === null ? 'muted' : 'destructive'}>{status.up ? 'Gateway running' : status.up === null ? 'Not checked yet' : 'Gateway not reachable'}</Badge>
      {status.checkedAt && <span className="small text-muted-foreground">checked {ago(status.checkedAt)}</span>}
      {status.up && admin && status.uiUrl && <Button asChild variant="outline" size="sm"><a href={status.uiUrl} target="_blank" rel="noreferrer">Open the gateway UI</a></Button>}
      {status.up && admin && !status.uiUrl && <Button variant="outline" size="sm" disabled title="Switched off on this installation: see below">Open the gateway UI</Button>}
      {!status.up && status.message && <span className="small text-muted-foreground">{status.message}</span>}
      {status.up && admin && !status.uiUrl && (
        <details className="small w-full text-muted-foreground" data-testid="gateway-ui-howto">
          <summary className="cursor-pointer">How to switch the gateway UI on</summary>
          <p className="m-0 mt-2">Port 15000 has no sign-in and can read and change gateway keys; while it is on, every program on this machine can reach it. It is off by default and published on 127.0.0.1 only. To switch it on, add these two lines to the environment file next to <span className="mono">compose.yaml</span> (join the profile with a comma if <span className="mono">COMPOSE_PROFILES</span> is already set), then run <span className="mono">docker compose up -d</span>:</p>
          <pre className="mono m-0 mt-2 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap text-foreground">{UI_SWITCH_ON}</pre>
          <p className="m-0 mt-2">The gateway settings, read-only, open here without that: <a className="text-primary" href="/-/gateway/config_dump" target="_blank" rel="noreferrer">gateway config</a>.</p>
        </details>
      )}
    </div>
  )
}
