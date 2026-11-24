'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { applyRetro } from '../../../../../core/retro/apply'
import { acceptProposal, sendMessage, startRetro } from '../../../../../core/retro/converse'
import { buildOutcome } from '../../../../../core/retro/outcome'
import { decideChange, decideTicket, editChange } from '../../../../../core/retro/outcome-edit'
import { DECISIONS, type Outcome } from '../../../../../core/retro/schema'
import { textOf } from '../../../lib/form-data'
import { applyDeps, converseDeps, failure, held, type Held } from '../../../lib/retro-wiring'
import { rangeFromParams } from '../../../lib/retro-range'

export type ActionResult = { error?: string }
export type OutcomeResult = { outcome?: Outcome; error?: string }

const FIELDS = ['product', 'range', 'tag', 'from', 'to', 'since']
const decision = z.enum(DECISIONS)
const here = (id: number) => `/memory/retro/${id}`

export async function startRetroAction(form: FormData): Promise<void> {
  const { payload, who } = await held()
  const params = Object.fromEntries(FIELDS.map((key) => [key, textOf(form, key)]))
  const product = z.coerce.number().int().positive().safeParse(params.product)
  const range = rangeFromParams(params)
  if (!product.success || !range) return redirect('/memory/retro')
  let id: number
  try {
    id = await startRetro(payload, await converseDeps(payload), who, { product: product.data, ...range })
  } catch (error) {
    const { error: message } = failure(error)
    return redirect(`/memory/retro?${new URLSearchParams({ ...params, error: message }).toString()}`)
  }
  redirect(here(id))
}

export async function sendMessageAction(retro: number, text: string): Promise<ActionResult> {
  const { payload, who } = await held()
  try {
    await sendMessage(payload, await converseDeps(payload), who, retro, text)
  } catch (error) {
    return failure(error)
  }
  revalidatePath(here(retro))
  return {}
}

export async function acceptProposalAction(retro: number, id: string): Promise<ActionResult> {
  const { payload, who } = await held()
  try {
    await acceptProposal(payload, who, retro, id)
  } catch (error) {
    return failure(error)
  }
  revalidatePath(here(retro))
  return {}
}

export async function toOutcomeAction(retro: number): Promise<void> {
  const { payload, who } = await held()
  await buildOutcome(payload, who, retro)
  redirect(`${here(retro)}/outcome`)
}

const outcomeOf = async (run: (held: Held) => Promise<Outcome>): Promise<OutcomeResult> => {
  try {
    return { outcome: await run(await held()) }
  } catch (error) {
    return failure(error)
  }
}

export const decideChangeAction = async (retro: number, id: string, value: unknown) =>
  outcomeOf(({ payload, who }) => decideChange(payload, who, retro, id, decision.parse(value)))

export const editChangeAction = async (retro: number, id: string, add: string) =>
  outcomeOf(({ payload, who }) => editChange(payload, who, retro, id, add))

export const decideTicketAction = async (retro: number, id: string, value: unknown) =>
  outcomeOf(({ payload, who }) => decideTicket(payload, who, retro, id, decision.parse(value)))

export const applyRetroAction = async (retro: number): Promise<OutcomeResult> => {
  const result = await outcomeOf(({ payload, who }) => applyRetro(payload, applyDeps(payload), who, retro))
  revalidatePath('/memory')
  return result
}
