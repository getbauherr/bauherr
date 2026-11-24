'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

const plain = (e: MouseEvent) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

const internalLink = (e: MouseEvent) => {
  const a = plain(e) ? (e.target as Element | null)?.closest('a[href]') : null
  if (!a || a.hasAttribute('download') || (a.getAttribute('target') ?? '_self') !== '_self') return null
  const url = new URL(a.getAttribute('href')!, location.href)
  const there = url.origin === location.origin && url.pathname + url.search !== location.pathname + location.search
  return there ? url.pathname + url.search + url.hash : null
}

export function LeaveGuard() {
  const router = useRouter()
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const href = internalLink(e)
      if (!href) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setTarget(href)
    }
    document.addEventListener('click', on, true)
    return () => document.removeEventListener('click', on, true)
  }, [])
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>Your changes in this section are not saved yet.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setTarget(null)}>
            Stay
          </Button>
          <Button
            onClick={() => {
              const href = target!
              setTarget(null)
              router.push(href)
            }}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
