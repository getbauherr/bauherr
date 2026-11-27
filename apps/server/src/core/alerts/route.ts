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

const readText = async (req: Request): Promise<string | undefined> => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_ALERT_BYTES) return undefined
  const reader = req.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    size += part.value.byteLength
    if (size > MAX_ALERT_BYTES) {
      await reader?.cancel()
      return undefined
    }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const readBody = async (req: Request): Promise<unknown> => {
  const text = await readText(req)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const authorised = (target: AlertTarget | null, req: Request): target is AlertTarget =>
  Boolean(target?.enabled && target.secret && bearerFits(req.headers.get('authorization'), target.secret))

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
  if (!authorised(target, req)) return status(404)
  const body = await readBody(req)
  const alerts = body === undefined ? null : parseAlerts(body)
  if (!allowAlerts(product, now, alerts?.length ?? 1)) return status(429, { 'retry-after': '60' })
  if (body === undefined) return status(413)
  if (!alerts) {
    return Response.json({ error: 'Send Grafana or Alertmanager JSON, or {title, fingerprint}.' }, { status: 400 })
  }
  return receiveAll(payload, deps, { workspace: target.workspace, product }, alerts)
}
