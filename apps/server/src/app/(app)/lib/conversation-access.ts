import { cookies } from 'next/headers'
import type { Payload } from 'payload'
import { conversationRecord, conversationWorkspace } from '../../../core/conversations/store'
import { findRequestConversation } from '../../../core/requests/comments'
import { loadDraft } from '../../../core/requests/store'
import { mayOpenRequest, requestScope } from '../../../core/views/request-access'
import { isBauherr, isProductOwner } from '../../../lib/people'
import { getPerson, payloadClient, WS_COOKIE, workspacesOf } from './session'

export type Granted = { payload: Payload; workspace: number }

type Person = NonNullable<Awaited<ReturnType<typeof getPerson>>>

const notFound = () => new Response(null, { status: 404 })

const signedIn = async (): Promise<Person | Response> =>
  (await getPerson()) ?? Response.json({ error: 'Sign in first.' }, { status: 401 })

const positiveId = (raw: string): number | null => {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

const mayUse = async (person: Person, workspace: number) =>
  !isProductOwner(person) && isBauherr(person) && (await workspacesOf(person)).some((w) => w.id === workspace)

const chosenWorkspace = async (person: Person, asked: number | undefined) => {
  if (asked !== undefined) return asked
  const slug = (await cookies()).get(WS_COOKIE)?.value
  const mine = await workspacesOf(person)
  return (mine.find((w) => w.slug === slug) ?? mine[0])?.id
}

export const grantWorkspace = async (asked: number | undefined): Promise<Granted | Response> => {
  const person = await signedIn()
  if (person instanceof Response) return person
  const workspace = await chosenWorkspace(person, asked)
  if (workspace === undefined || !(await mayUse(person, workspace))) return notFound()
  return { payload: await payloadClient(), workspace }
}

const mayUseFiles = async (person: Person, payload: Payload, id: number) => {
  const recordId = await conversationRecord(payload, id)
  const scope = recordId === null ? null : await requestScope(payload, recordId)
  if (recordId === null || scope === null || !mayOpenRequest(person, scope)) return false
  return (await findRequestConversation(payload, scope.workspace, recordId)) === id
}

export const grantConversation = async (
  rawId: string,
  access: 'files' | 'all' = 'all',
): Promise<(Granted & { id: number }) | Response> => {
  const person = await signedIn()
  if (person instanceof Response) return person
  const id = positiveId(rawId)
  if (id === null) return notFound()
  const payload = await payloadClient()
  const workspace = await conversationWorkspace(payload, id)
  if (workspace === null) return notFound()
  const allowed =
    isProductOwner(person) && access === 'files'
      ? await mayUseFiles(person, payload, id)
      : await mayUse(person, workspace)
  return allowed ? { payload, workspace, id } : notFound()
}

const mayRequest = async (person: Person, workspace: number, product: number) =>
  (await workspacesOf(person)).some((w) => w.id === workspace) && mayOpenRequest(person, { workspace, product })

export const grantNewRequest = async (
  asked: number | undefined,
  product: number,
): Promise<Granted | Response> => {
  const person = await signedIn()
  if (person instanceof Response) return person
  const workspace = await chosenWorkspace(person, asked)
  if (workspace === undefined || !(await mayRequest(person, workspace, product))) {
    return notFound()
  }
  return { payload: await payloadClient(), workspace }
}

export const grantRequest = async (rawId: string): Promise<(Granted & { id: number }) | Response> => {
  const person = await signedIn()
  if (person instanceof Response) return person
  const id = positiveId(rawId)
  if (id === null) return notFound()
  const payload = await payloadClient()
  const draft = await loadDraft(payload, id)
  if (!draft || !(await mayRequest(person, draft.workspace, draft.product))) return notFound()
  return { payload, workspace: draft.workspace, id }
}
