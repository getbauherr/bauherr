import type { Payload } from 'payload'

export const scanned = (payload: Payload, ticket: number | string, workspace: number | string) =>
  payload.create({ collection: 'runs', data: { ticket: Number(ticket), stage: 'plan', kind: 'agent', job: 'ax-scan', role: 'ax', status: 'succeeded', outcome: 'pass', mode: 'autonomous', workspace: Number(workspace) }, overrideAccess: true })

export const walked = (payload: Payload, ticket: number | string, workspace: number | string) =>
  payload.create({ collection: 'runs', data: { ticket: Number(ticket), stage: 'release', kind: 'agent', job: 'staging-walk', role: 'ax', status: 'succeeded', outcome: 'pass', mode: 'autonomous', workspace: Number(workspace) }, overrideAccess: true })
