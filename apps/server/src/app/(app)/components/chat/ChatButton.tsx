'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { isOpen, setOpen, subscribe } from './dock-state'
import { Chat } from './icons'

/** Header button that opens the dock (icon only on phones); the dock closes itself with its own button. */
export function ChatButton() {
  const open = useSyncExternalStore(subscribe, isOpen, () => false)
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])
  const hint = mac ? '⌘J' : 'Ctrl+J'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" data-testid="chat-open" aria-label="Ask the factory" aria-expanded={open} aria-controls="chat-dock" aria-keyshortcuts="Control+J Meta+J" className="max-sm:size-9 max-sm:px-0" onClick={() => setOpen(!isOpen())}>
          <Chat />
          <span className="max-sm:hidden">Ask</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Ask the factory ({hint})</TooltipContent>
    </Tooltip>
  )
}
