import type { Payload } from 'payload'
import { queueItem } from './queue'
import { reduceGithub, reduceGitlab, type HookItem } from './reduce'
import { markDelivered, openPullsAt, trackedSource, webhookOf, type Webhook } from './store'
import { verifyGithub, verifyGitlab } from './verify'

export const MAX_BODY_BYTES = 5 * 1024 * 1024

type Target = { source: number; item: HookItem }

const parseJson = (raw: Uint8Array): unknown => {
  try {
    return JSON.parse(Buffer.from(raw).toString('utf8'))
  } catch {
    return null
  }
}

const isVerified = (webhook: Webhook, secret: string, headers: Headers, raw: Uint8Array): boolean => {
  if (webhook.kind === 'github') return verifyGithub(secret, raw, headers.get('x-hub-signature-256'))
  return webhook.kind === 'gitlab' && verifyGitlab(secret, headers.get('x-gitlab-token'))
}

const reduced = (kind: string, headers: Headers, raw: Uint8Array) =>
  kind === 'github'
    ? reduceGithub(headers.get('x-github-event') ?? '', parseJson(raw))
    : reduceGitlab(headers.get('x-gitlab-event') ?? '', parseJson(raw))

const targetsOf = async (
  payload: Payload,
  connection: number,
  { items, heads }: ReturnType<typeof reduced>,
): Promise<Target[]> => {
  const targets: Target[] = []
  for (const item of items) {
    const source = await trackedSource(payload, connection, item.repo)
    if (source !== null) targets.push({ source, item })
  }
  for (const head of heads) {
    const source = await trackedSource(payload, connection, head.repo)
    if (source === null) continue
    for (const item of await openPullsAt(payload, source, head)) targets.push({ source, item })
  }
  return targets
}

export const receiveDelivery = async (
  payload: Payload,
  connection: number,
  headers: Headers,
  raw: Uint8Array,
  now: Date,
): Promise<202 | 401> => {
  const webhook = await webhookOf(payload, connection)
  if (!webhook?.secret || !isVerified(webhook, webhook.secret, headers, raw)) return 401
  await markDelivered(payload, connection, now)
  for (const { source, item } of await targetsOf(payload, connection, reduced(webhook.kind, headers, raw))) {
    await queueItem(payload, { source, kind: item.kind, number: item.number })
  }
  return 202
}
