'use server'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { createReleaser, ReleaseRefused } from '../../../../core/releases/run'
import { OPTIONS } from '../../../../core/releases/run-steps'
import { releasesPage } from '../../../../core/releases/view'
import {
  addItem,
  editItem,
  removeItem,
  UNRELEASED,
  writeNotesFor,
  type Where,
} from '../../../../core/releases/notes-store'
import { publicUrl } from '../../../../lib/oidc'
import { gatewayModel } from '../../lib/retro-model'
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

export async function releaseAction(form: FormData): Promise<void> {
  const { payload, at } = await inProduct(form)
  const notesLink = `${publicUrl()}/releases?product=${at.product}#notes`
  const model = gatewayModel(payload)
  try {
    await createReleaser(payload).start(
      { workspace: at.workspace, product: at.product, version: textOf(form, 'version').trim(), notesLink },
      (system, user) => model(at.workspace, system, [{ role: 'user', content: user }]),
    )
  } catch (error) {
    if (!(error instanceof ReleaseRefused)) throw error
    redirect(`/releases?product=${at.product}&refused=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/releases')
}

export async function answerReleaseAction(form: FormData): Promise<void> {
  const { payload, at } = await inProduct(form)
  const run = id.safeParse(textOf(form, 'run'))
  const option = z.enum(OPTIONS).safeParse(textOf(form, 'option'))
  if (run.success && option.success) await createReleaser(payload).answer(at, run.data, option.data)
  revalidatePath('/releases')
}
