import type { TaskConfig } from 'payload'
import { measureOutsideRuns, measureRuns } from '../core/cost-store'
import { gatewayRequests } from '../lib/gateway-usage'
import { scheduled } from '../lib/schedule'

export const measureCostTask: TaskConfig<{ input: Record<string, never>; output: { measured: number } }> = {
  slug: 'measure-cost',
  schedule: scheduled('0 */5 * * * *'),
  retries: 0,
  concurrency: () => 'measure-cost',
  handler: async ({ req }) => {
    if (!process.env.GATEWAY_DATABASE_URL) return { output: { measured: 0 } }
    const now = new Date()
    const measured = await measureRuns(req.payload, gatewayRequests, now)
    await measureOutsideRuns(req.payload, gatewayRequests, now)
    return { output: { measured } }
  },
}
