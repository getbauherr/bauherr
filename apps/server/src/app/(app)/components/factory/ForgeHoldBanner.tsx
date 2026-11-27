import type { Hold } from '../../../../core/forge/limits'
import { Alert, AlertDescription } from '../ui/alert'

export function ForgeHoldBanner({ holds }: { holds: Hold[] }) {
  return holds.map((hold) => (
    <Alert key={hold.message} className="border-warn">
      <AlertDescription>{hold.message}</AlertDescription>
    </Alert>
  ))
}
