'use client'
import { useAui, type ThreadMessageLike } from '@assistant-ui/react'
import { useEffect, type FC } from 'react'
import type { Msg } from '../../../../lib/refine/model'

export const pending = (id: string, role: Msg['role'], text: string, speaker: Msg['speaker']): ThreadMessageLike => ({
  id,
  role,
  createdAt: new Date(speaker.at),
  content: text ? [{ type: 'text', text }] : [],
  ...(role === 'assistant' && { status: { type: 'running' } as const }),
  metadata: { custom: { speaker } },
})

export const toMessage = (m: Msg, text = m.text): ThreadMessageLike => ({
  id: m.id,
  role: m.role,
  createdAt: new Date(m.speaker.at),
  content: text ? [{ type: 'text', text }] : [],
  ...(m.role === 'assistant' && { status: { type: 'complete', reason: 'stop' } as const }),
  metadata: { custom: { speaker: m.speaker, feedback: m.feedback ?? null, images: m.images ?? [], settled: m.settled ?? [] } },
})

export const textOf = (m: { content: readonly { type: string; text?: string }[] }): string => m.content.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()
/** The media id of an uploaded image: its signed URL is `/m/<id>/<signature>.<ext>`. */
export const mediaId = (url: string): number | null => Number(/\/m\/(\d+)\//.exec(url)?.[1]) || null

/** Pulls the composer's text back when a failed turn did not take it. */
export const Restore: FC<{ text: string; done(): void }> = ({ text, done }) => {
  const aui = useAui()
  useEffect(() => {
    if (!text) return
    aui.composer().setText(text)
    done()
  }, [text, aui, done])
  return null
}

