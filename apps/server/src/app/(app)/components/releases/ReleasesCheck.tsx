import type { LastCheck } from '../../../../core/readiness/last-check'
import { CheckNow } from '../product/ReadinessActions'
import { Time } from '../Time'
import { Alert } from '../ui/alert'

type Props = { check: LastCheck | null; product: number; canCheck: boolean }

function CheckLine({ check, product, canCheck }: Props) {
  return (
    <div className="small flex flex-wrap items-baseline gap-2 text-muted-foreground">
      {check === null ? 'The readiness check has not run for this Product.' : (
        <>Last readiness check <Time iso={check.at} /></>
      )}
      {canCheck && <CheckNow product={product} button />}
    </div>
  )
}

export function CheckError({ check }: { check: LastCheck | null }) {
  if (!check?.error) return null
  return (
    <Alert role="alert" className="small text-destructive">
      The last readiness check failed: {check.error}
    </Alert>
  )
}

export function ReleasesUnread({ check, product, canCheck }: Props) {
  return (
    <div className="grid gap-3 py-12">
      <p className="body">The repository has not been read yet. Releases appear after the next readiness check.</p>
      <CheckError check={check} />
      <CheckLine check={check} product={product} canCheck={canCheck} />
    </div>
  )
}
