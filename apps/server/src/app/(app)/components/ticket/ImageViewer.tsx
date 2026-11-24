'use client'
import { useState, type KeyboardEvent, type RefObject, type TouchEvent } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import type { ImageRef } from './image-ref'
import { ViewerBar } from './ViewerBar'
import { ViewerPicture } from './ViewerPicture'

const FRAME =
  'top-0 left-0 grid h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] ' +
  'gap-0 rounded-none border-0 p-0 sm:max-w-none'
const SWIPE_MIN = 50

export const swipeStep = (dx: number, dy: number): -1 | 0 | 1 => {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}

type Props = {
  images: ImageRef[]
  shown: number | null
  onShow: (index: number | null) => void
  opener: RefObject<HTMLElement | null>
}

export function ImageViewer({ images, shown, onShow, opener }: Props) {
  const [natural, setNatural] = useState(false)
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const image = shown === null ? null : images[shown]
  const step = (by: number) => {
    if (shown === null || images.length < 2) return
    setNatural(false)
    onShow((shown + by + images.length) % images.length)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') step(1)
    if (event.key === 'ArrowLeft') step(-1)
  }
  const onTouchEnd = (event: TouchEvent) => {
    const end = event.changedTouches[0]
    if (touchStart && !natural) step(swipeStep(end.clientX - touchStart.x, end.clientY - touchStart.y))
    setTouchStart(null)
  }
  const close = () => {
    setNatural(false)
    onShow(null)
  }
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && close()}>
      {image && shown !== null && (
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={false}
          className={FRAME}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        >
          <ViewerBar
            image={image}
            position={`${shown + 1} of ${images.length}`}
            many={images.length > 1}
            natural={natural}
            onStep={step}
            onToggle={() => setNatural(!natural)}
          />
          <ViewerPicture
            image={image}
            natural={natural}
            onToggle={() => setNatural(!natural)}
            onTouchStart={(event) => setTouchStart({ x: event.touches[0].clientX, y: event.touches[0].clientY })}
            onTouchEnd={onTouchEnd}
          />
          <div className="border-t border-border p-3">
            <DialogTitle>{image.caption}</DialogTitle>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
