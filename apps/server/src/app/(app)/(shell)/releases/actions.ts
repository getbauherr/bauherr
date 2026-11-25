'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { releasesPage } from '../../../../core/releases/view'
import {
  addItem,
  editItem,
  removeItem,
  UNRELEASED,
  writeNotesFor,
  type Where,
} from '../../../../core/releases/notes-store'
import { gatewayModel } from '../../../../lib/retro-model'
import { textOf } from '../../lib/form-data'
import { held } from '../../lib/retro-wiring'

const id = z.coerce.number().int().positive()
const kind = z.enum(['new', 'fixed'])

const inProduct = async (form: FormData) => {
  const { payload, who } = await held()
  const product = id.safeParse(textOf(form, 'product'))
  if (!product.success) return notFound()
  const view = await releasesPage(payload, { workspace: who.workspace, product: product.data })
  if (view.product?.id !== product.data) return notFound()
  const at: Where = { workspace: who.workspace, product: product.data, version: UNRELEASED }
  return { payload, at, view }
}

const edit = (form: FormData) => ({
  title: textOf(form, 'title'),
  text: textOf(form, 'text'),
  area: textOf(form, 'area'),
})

export async function writeNotesAction(form: FormData): Promise<void> {
  const { payload, at, view } = await inProduct(form)
  const model = gatewayModel(payload)
  await writeNotesFor(payload, at, view.ready?.tickets ?? [], (system, user) =>
    model(at.workspace, system, [{ role: 'user', content: user }]),
  )
  revalidatePath('/releases')
}

export async function editNoteAction(form: FormData): Promise<void> {
  const { payload, at } = await inProduct(form)
  await editItem(payload, at, textOf(form, 'item'), edit(form))
  revalidatePath('/releases')
}

export async function addNoteAction(form: FormData): Promise<void> {
  const { payload, at, view } = await inProduct(form)
  const chosen = kind.safeParse(textOf(form, 'kind'))
  if (chosen.success) {
    await addItem(payload, at, chosen.data, edit(form), view.ready?.tickets.map((ticket) => ticket.number) ?? [])
  }
  revalidatePath('/releases')
}

export async function removeNoteAction(form: FormData): Promise<void> {
  const { payload, at } = await inProduct(form)
  await removeItem(payload, at, textOf(form, 'item'))
  revalidatePath('/releases')
}
