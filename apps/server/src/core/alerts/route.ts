import { createHash, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'
import { WriteError } from '../forge/errors'
import { allowAlerts } from './limit'
import { parseAlerts, type Alert } from './parse'
import { receiveAlert, type AlertDeps } from './receive'
import { alertTarget, type AlertTarget } from './store'

export const MAX_ALERT_BYTES = 256 * 1024

type Where = { workspace: number; product: number }

const digest = (value: string) => createHash('sha256').update(value).digest()

export const bearerFits = (header: string | null, secret: string): boolean => {
  const given = /^Bearer (\S+)$/.exec(header ?? '')?.[1] ?? ''
  return timingSafeEqual(digest(given), digest(secret)) && given !== ''
}

const status = (code: number, headers: Record<string, string> = {}) => new Response(null, { status: code, headers })

const readBody = async (req: Request): Promise<unknown> => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_ALERT_BYTES) return undefined
  const text = await req.text()
  if (text.length > MAX_ALERT_BYTES) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const refusal = (target: AlertTarget | null, req: Request, product: number, now: number): Response | null => {
  if (!target?.enabled || !target.secret) return status(404)
  if (!bearerFits(req.headers.get('authorization'), target.secret)) return status(401)
  return allowAlerts(product, now) ? null : status(429, { 'retry-after': '60' })
}

const receiveAll = async (payload: Payload, deps: AlertDeps, where: Where, alerts: Alert[]): Promise<Response> => {
  const counts = { opened: 0, commented: 0, ignored: 0 }
  try {
    for (const alert of alerts) counts[await receiveAlert(payload, deps, where, alert)]++
  } catch (error) {
    if (error instanceof WriteError) return Response.json({ error: error.message }, { status: 502 })
    throw error
  }
  return Response.json(counts, { status: 202 })
}

export const handleAlert = async (
  payload: Payload,
  deps: AlertDeps,
  product: number,
  req: Request,
  now: number,
): Promise<Response> => {
  const target = Number.isInteger(product) && product > 0 ? await alertTarget(payload, product) : null
  const refused = refusal(target, req, product, now)
  if (refused || !target) return refused ?? status(404)
  const body = await readBody(req)
  if (body === undefined) return status(413)
  const alerts = parseAlerts(body)
  if (!alerts) {
    return Response.json({ error: 'Send Grafana or Alertmanager JSON, or {title, fingerprint}.' }, { status: 400 })
  }
  return receiveAll(payload, deps, { workspace: target.workspace, product }, alerts)
}
