'use client'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useState, type FC } from 'react'
import { postDockComment } from '../../lib/actions'
import { makeAttachments } from '../chat/adapter'
import { Composer } from './Composer'
import { Restore, mediaId, textOf } from './shared'

const attachments = makeAttachments()
const noMessages: ThreadMessageLike[] = []

/** The Ticket page's composer when no refinement is open: it posts a Comment to the Ticket's issue (pasted images included). The agent reads it at its next Run. */
export const CommentBox: FC<{ ticket: number }> = ({ ticket }) => {
  const router = useRouter()
  const [posted, setPosted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: noMessages,
    isRunning: false,
    convertMessage: (m) => m,
    adapters: { attachments },
    onNew: async (m) => {
      const text = textOf(m)
      const images = (m.attachments ?? []).flatMap((a) => a.content ?? []).flatMap((p) => (p.type === 'image' ? [mediaId(p.image)] : [])).filter((i): i is number => i !== null)
      setPosted(false)
      setError(null)
      const r = await postDockComment(ticket, text, images)
      if ('error' in r) {
        setRestore(text)
        return setError(images.length ? 'The comment was not posted. Your text is kept; attach the image again.' : r.error)
      }
      setPosted(true)
      router.refresh()
    },
  })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Restore text={restore} done={() => setRestore('')} />
      <div data-testid="comment-box" className="flex flex-col gap-2">
        {posted && <p role="status" data-testid="comment-posted" className="m-0 text-[13px] text-muted-foreground">Posted to the issue. The agent reads it at its next Run.</p>}
        {error && <p role="alert" data-testid="comment-error" className="m-0 text-[13px] text-destructive">{error}</p>}
        <Composer models={[]} tier="standard" cost={null} placeholder="Comment on the issue" label="Comment" streaming={false} onStop={() => {}} />
      </div>
    </AssistantRuntimeProvider>
  )
}
