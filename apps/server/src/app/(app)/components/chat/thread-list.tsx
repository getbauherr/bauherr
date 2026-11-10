'use client'
import { ThreadListItemPrimitive, ThreadListPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Archive, List, Pencil, Trash } from './icons'

const iconBtn = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'

const Row: FC<{ close(): void }> = ({ close }) => {
  const aui = useAui()
  const title = useAuiState((s) => s.threadListItem.title) ?? 'New chat'
  const active = useAuiState((s) => s.threadListItem.id === s.threads.mainThreadId)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  return (
    <ThreadListItemPrimitive.Root className={cn('flex items-center gap-1 rounded-md px-1', active && 'bg-accent')} data-testid="thread-item">
      {editing !== null ? (
        <form className="flex min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); void aui.threadListItem().rename(editing.trim() || title); setEditing(null) }}>
          <input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} onBlur={() => setEditing(null)} maxLength={60} aria-label="Chat title" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </form>
      ) : (
        <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 truncate py-1.5 text-left text-[14px]" onClick={close}><ThreadListItemPrimitive.Title fallback="New chat" /></ThreadListItemPrimitive.Trigger>
      )}
      <button type="button" aria-label="Rename" title="Rename" className={iconBtn} onClick={() => setEditing(title)}><Pencil /></button>
      <button type="button" aria-label="Archive" title="Archive" className={iconBtn} onClick={() => void aui.threadListItem().archive()}><Archive /></button>
      <button type="button" aria-label="Delete" title="Delete" className={iconBtn} onClick={() => setDeleting(true)}><Trash /></button>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogTitle className="font-semibold">Delete this chat?</DialogTitle>
          <DialogDescription className="text-[14px] text-muted-foreground">{title} and its messages are removed for good.</DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="button" variant="destructive" onClick={() => { void aui.threadListItem().delete(); setDeleting(false) }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </ThreadListItemPrimitive.Root>
  )
}

/** The person's chats in a popover: new, switch, rename, archive, delete (confirmed in a dialog). */
export const ThreadList: FC = () => {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" aria-label="Chats" title="Chats" data-testid="thread-list-button" className={iconBtn}><List /></button></PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[60dvh] w-[min(22rem,calc(100vw-2rem))] flex-col gap-1 overflow-y-auto p-2" data-testid="thread-list">
        <ThreadListPrimitive.Root className="aui-root flex flex-col gap-1">
          <ThreadListPrimitive.New asChild><Button type="button" variant="outline" size="sm" className="justify-start" onClick={() => setOpen(false)}><Plus />New chat</Button></ThreadListPrimitive.New>
          <ThreadListPrimitive.Items>{() => <Row close={() => setOpen(false)} />}</ThreadListPrimitive.Items>
        </ThreadListPrimitive.Root>
      </PopoverContent>
    </Popover>
  )
}
