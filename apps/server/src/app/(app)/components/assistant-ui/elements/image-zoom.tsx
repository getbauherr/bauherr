'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PropsWithChildren,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
const trapTab = (e: KeyboardEvent, container: HTMLElement | null) => {
  const focusables = container?.querySelectorAll<HTMLElement>(FOCUSABLE)
  const first = focusables?.[0]
  const last = focusables?.[focusables.length - 1]
  if (!first || !last) return
  if (document.activeElement !== (e.shiftKey ? first : last)) return
  e.preventDefault()
  ;(e.shiftKey ? last : first).focus()
}
const useFocusTrap = (isOpen: boolean, overlayRef: RefObject<HTMLDivElement | null>, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab') trapTab(e, overlayRef.current)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, overlayRef])
}
const useBodyScrollLock = (isOpen: boolean) => {
  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])
}
const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.click()
  } else if (e.key === ' ') {
    e.preventDefault()
  }
}
const handleTriggerKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
  if (e.key === ' ') e.currentTarget.click()
}

interface ZoomOverlayProps {
  src: string
  alt: string
  overlayRef: RefObject<HTMLDivElement | null>
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}
function ZoomOverlay({ src, alt, overlayRef, closeRef, onClose }: ZoomOverlayProps) {
  return (
    <div
      ref={overlayRef}
      data-slot="image-zoom-overlay"
      role="dialog"
      aria-modal="true"
      className={cn(
        'aui-image-zoom-overlay fade-in animate-in fixed inset-0 z-50 flex items-center',
        'justify-center bg-background/80 duration-200',
      )}
      onClick={onClose}
      aria-label="Zoomed image"
    >
      <picture className="contents">
        <img
          data-slot="image-zoom-content"
          src={src}
          alt={alt}
          className={cn(
            'aui-image-zoom-content fade-in zoom-in-95 animate-in max-h-[90%] max-w-[90%]',
            'cursor-zoom-out object-contain duration-200',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        />
      </picture>
      <button
        ref={closeRef}
        type="button"
        aria-label="Close zoomed image"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={cn(
          'text-muted-foreground hover:text-foreground bg-background/80 absolute end-4',
          'top-4 rounded-md p-2',
        )}
      >
        <XIcon className="size-5" />
      </button>
    </div>
  )
}

type ImageZoomProps = PropsWithChildren<{
  src: string
  alt?: string
}>
export function ImageZoom({ src, alt = 'Image preview', children }: ImageZoomProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const handleOpen = useCallback(() => setIsOpen(true), [])
  const handleClose = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }, [])
  useFocusTrap(isOpen, overlayRef, handleClose)
  useBodyScrollLock(isOpen)
  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen])
  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        onKeyDown={handleTriggerKeyDown}
        onKeyUp={handleTriggerKeyUp}
        role="button"
        tabIndex={0}
        className="aui-image-zoom-trigger cursor-zoom-in"
        aria-label="Click to zoom image"
      >
        {children}
      </div>
      {isOpen &&
        createPortal(
          <ZoomOverlay src={src} alt={alt} overlayRef={overlayRef} closeRef={closeRef} onClose={handleClose} />,
          document.body,
        )}
    </>
  )
}
