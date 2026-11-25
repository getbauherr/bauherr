import { cookies } from 'next/headers'
import type { Payload } from 'payload'
import { conversationRecord, conversationWorkspace } from '../../../core/conversations/store'
import { findRequestConversation } from '../../../core/requests/comments'
import { loadDraft } from '../../../core/requests/store'
import { mayOpenRequest, requestScope } from '../../../core/views/request-access'
import { isBauherr, isProductOwner } from '../../../lib/people'
import { getPerson, payloadClient, WS_COOKIE, workspacesOf } from './session'

export type Granted = { payload: Payload; workspace: number }

const NOT_SIGNED_IN = { error: 'Sign in first.' }

const mayUse = async (person: NonNullable<Awaited<ReturnType<typeof getPerson>>>, workspace: number) =>
  !isProductOwner(person) && isBauherr(person) && (await workspacesOf(person)).some((w) => w.id === workspace)

const chosenWorkspace = async (person: Parameters<typeof workspacesOf>[0], asked: number | undefined) => {
  if (asked !== undefined) return asked
  const slug = (await cookies()).get(WS_COOKIE)?.value
  const mine = await workspacesOf(person)
  return (mine.find((w) => w.slug === slug) ?? mine[0])?.id
}

export const grantWorkspace = async (asked: number | undefined): Promise<Granted | Response> => {
  const person = await getPerson()
  if (!person) return Response.json(NOT_SIGNED_IN, { status: 401 })
  const workspace = await chosenWorkspace(person, asked)
  if (workspace === undefined || !(await mayUse(person, workspace))) return new Response(null, { status: 404 })
  return { payload: await payloadClient(), workspace }
}

const mayUseFiles = async (person: Parameters<typeof mayOpenRequest>[0], payload: Payload, id: number) => {
  const recordId = await conversationRecord(payload, id)
  const scope = recordId === null ? null : await requestScope(payload, recordId)
  if (recordId === null || scope === null || !mayOpenRequest(person, scope)) return false
  return (await findRequestConversation(payload, scope.workspace, recordId)) === id
}

export const grantConversation = async (
  rawId: string,
  access: 'files' | 'all' = 'all',
): Promise<(Granted & { id: number }) | Response> => {
  const person = await getPerson()
  if (!person) return Response.json(NOT_SIGNED_IN, { status: 401 })
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return new Response(null, { status: 404 })
  const payload = await payloadClient()
  const workspace = await conversationWorkspace(payload, id)
  if (workspace === null) return new Response(null, { status: 404 })
  const allowed =
    isProductOwner(person) && access === 'files'
      ? await mayUseFiles(person, payload, id)
      : await mayUse(person, workspace)
  return allowed ? { payload, workspace, id } : new Response(null, { status: 404 })
}

type Person = NonNullable<Awaited<ReturnType<typeof getPerson>>>

const mayRequest = async (person: Person, workspace: number, product: number) =>
  (await workspacesOf(person)).some((w) => w.id === workspace) && mayOpenRequest(person, { workspace, product })

export const grantNewRequest = async (
  asked: number | undefined,
  product: number,
): Promise<Granted | Response> => {
  const person = await getPerson()
  if (!person) return Response.json(NOT_SIGNED_IN, { status: 401 })
  const workspace = await chosenWorkspace(person, asked)
  if (workspace === undefined || !(await mayRequest(person, workspace, product))) {
    return new Response(null, { status: 404 })
  }
  return { payload: await payloadClient(), workspace }
}

export const grantRequest = async (rawId: string): Promise<(Granted & { id: number }) | Response> => {
  const person = await getPerson()
  if (!person) return Response.json(NOT_SIGNED_IN, { status: 401 })
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return new Response(null, { status: 404 })
  const payload = await payloadClient()
  const draft = await loadDraft(payload, id)
  if (!draft || !(await mayRequest(person, draft.workspace, draft.product))) return new Response(null, { status: 404 })
  return { payload, workspace: draft.workspace, id }
}
