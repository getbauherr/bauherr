'use client'

import { useExternalStoreRuntime } from '@assistant-ui/react'
import { useMemo, useRef, useState } from 'react'
import { attachmentAdapter, toThreadMessage } from '../conversation/conversation-adapter'
import { conversationApi, type ConversationEntry } from '../conversation/conversation-api'
import { fileIdsOf, textOf } from '../conversation/useConversationRuntime'
import type { DraftView } from '../../../../core/requests/view'
import { requestApi, type RequestAction, type RequestState } from './request-api'

const files = conversationApi()
const requests = requestApi()

export type Initial = { id: number; product: number; messages: ConversationEntry[]; draft: DraftView | null }

const ensureConversation = (
  id: { current: number | null },
  creating: { current: Promise<number> | null },
  workspace: number,
  product: number,
): Promise<number> => {
  if (id.current !== null) return Promise.resolve(id.current)
  creating.current ??= requests.create(workspace, product).then((created) => {
    id.current = created
    window.history.replaceState(null, '', `/requests/new?draft=${created}`)
    return created
  })
  return creating.current
}

const failed = (error: unknown): string => (error instanceof Error ? error.message : 'That did not work.')

export const useRequestSession = (workspace: number, product: number, initial: Initial | null) => {
  const [entries, setEntries] = useState(initial?.messages ?? [])
  const [draft, setDraft] = useState(initial?.draft ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useRef(initial?.id ?? null)
  const productRef = useRef(product)
  const creating = useRef<Promise<number> | null>(null)

  const ensure = () => ensureConversation(id, creating, workspace, productRef.current)
  const show = (next: RequestState) => {
    setEntries(next.messages)
    setDraft(next.draft)
  }
  const run = async (work: (conversation: number) => Promise<RequestState>) => {
    setError(null)
    setBusy(true)
    try {
      show(await work(await ensure()))
    } catch (failure) {
      setError(failed(failure))
    } finally {
      setBusy(false)
    }
  }
  const act = (action: RequestAction) => void run((conversation) => requests.act(conversation, action))
  const say = (text: string, fileIds: number[]) => run((c) => requests.act(c, { action: 'message', text, fileIds }))

  const attachments = useMemo(
    () =>
      attachmentAdapter(ensure, {
        ...files,
        upload: async (conversation, upload) => {
          const stored = await files.upload(conversation, upload)
          show(await requests.state(conversation))
          return stored
        },
      }),
    [],
  )
  const runtime = useExternalStoreRuntime<ConversationEntry>({
    messages: entries,
    isRunning: false,
    convertMessage: (entry) => toThreadMessage(id.current ?? 0, entry),
    onNew: (message) => say(textOf(message), fileIdsOf(message)),
    adapters: { attachments },
  })
  return {
    runtime,
    draft,
    error,
    busy,
    act,
    answer: (text: string) => void say(text, []),
    started: id.current !== null,
    setProduct: (next: number) => void (productRef.current = next),
  }
}
