'use client'

import { isValidElement, useState, type FC, type PropsWithChildren } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const FADE = 'block h-auto max-h-[80vh] w-auto max-w-full rounded-sm object-contain transition-opacity duration-300'

const AttachmentPreview: FC<{ src: string; name: string }> = ({ src, name }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  return (
    <img
      src={src}
      alt={`Preview of ${name}`}
      className={cn(FADE, isLoaded ? 'opacity-100' : 'opacity-0')}
      onLoad={() => setIsLoaded(true)}
    />
  )
}

type Props = PropsWithChildren<{ src: string | undefined; name: string }>

export const AttachmentPreviewDialog: FC<Props> = ({ children, src, name }) => {
  if (!src) return children
  return (
    <Dialog>
      <DialogTrigger className="cursor-zoom-in" asChild>
        {isValidElement(children) ? children : <button type="button">{children}</button>}
      </DialogTrigger>
      <DialogContent className="p-2 sm:max-w-3xl">
        <DialogTitle className="sr-only">Preview {name}</DialogTitle>
        <div className="relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden">
          <AttachmentPreview src={src} name={name} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
