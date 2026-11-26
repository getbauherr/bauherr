'use client'

import { useState, useEffect, useRef } from 'react'
import { ImageIcon, ImageOffIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type ImagePreviewProps = Omit<React.ComponentProps<'img'>, 'children'> & {
  containerClassName?: string | undefined
  ratio?: 'auto' | '1:1' | '4:3' | '16:9' | '9:16' | undefined
  fit?: 'cover' | 'contain' | undefined
}

const RATIO_CLASS = {
  '1:1': 'aspect-square',
  '4:3': 'aspect-[4/3]',
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
}

const useImageStatus = (src: string | Blob | undefined) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined)
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined)
  useEffect(() => {
    const image = imgRef.current
    if (typeof src !== 'string' || !image?.complete) return
    if (image.naturalWidth > 0) setLoadedSrc(src)
    else setErrorSrc(src)
  }, [src])
  return {
    imgRef,
    loaded: loadedSrc === src,
    error: errorSrc === src,
    markLoaded: () => {
      if (typeof src === 'string') setLoadedSrc(src)
    },
    markError: () => {
      if (typeof src === 'string') setErrorSrc(src)
    },
  }
}

const imageSizing = (fixedRatio: boolean, fit: 'cover' | 'contain') =>
  fixedRatio
    ? cn('block h-full w-full', { 'object-cover': fit === 'cover', 'object-contain': fit === 'contain' })
    : 'block h-auto w-full object-contain'

function PreviewLoading() {
  return (
    <div data-slot="image-preview-loading" className="bg-muted/50 absolute inset-0 flex items-center justify-center">
      <ImageIcon className="text-muted-foreground size-8 animate-pulse" />
    </div>
  )
}

function PreviewError({ fixedRatio }: { fixedRatio: boolean }) {
  return (
    <div
      data-slot="image-preview-error"
      className={cn('bg-muted/50 flex min-h-32 items-center justify-center p-4', fixedRatio && 'absolute inset-0')}
    >
      <ImageOffIcon className="text-muted-foreground size-8" />
    </div>
  )
}

export function ImagePreview({
  className,
  containerClassName,
  ratio = 'auto',
  fit = 'contain',
  onLoad,
  onError,
  alt = 'Image content',
  src,
  ...props
}: ImagePreviewProps) {
  const { imgRef, loaded, error, markLoaded, markError } = useImageStatus(src)
  const fixedRatio = ratio !== 'auto'
  const ratioClassName = ratio === 'auto' ? undefined : RATIO_CLASS[ratio]
  return (
    <div
      data-slot="image-preview"
      className={cn('relative', fixedRatio ? ratioClassName : 'min-h-32', containerClassName)}
    >
      {!loaded && !error && <PreviewLoading />}
      {error ? (
        <PreviewError fixedRatio={fixedRatio} />
      ) : (
        <picture className="contents">
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            className={cn(imageSizing(fixedRatio, fit), !loaded && 'invisible', className)}
            onLoad={(e) => {
              markLoaded()
              onLoad?.(e)
            }}
            onError={(e) => {
              markError()
              onError?.(e)
            }}
            {...props}
          />
        </picture>
      )}
    </div>
  )
}
