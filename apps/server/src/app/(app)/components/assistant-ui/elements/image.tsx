'use client'

import { memo, useState } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CopyIcon, DownloadIcon, Loader2Icon, RefreshCwIcon, ShieldAlertIcon } from 'lucide-react'
import type { ImageMessagePart, ImageMessagePartComponent } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { hostOf, safeHref } from '../utils/href'
import { copyImagePart, downloadImagePart } from './image-utils'
import { ImagePreview } from './image-preview'
import { ImageZoom } from './image-zoom'
const imageVariants = cva('aui-image-root relative overflow-hidden rounded-lg', {
  variants: {
    variant: {
      outline: 'border-border border',
      ghost: '',
      muted: 'bg-muted/50',
    },
    size: {
      sm: 'max-w-64',
      default: 'max-w-96',
      lg: 'max-w-[512px]',
      full: 'w-full',
    },
  },
  defaultVariants: {
    variant: 'outline',
    size: 'default',
  },
})
export type ImageRootProps = React.ComponentProps<'div'> & VariantProps<typeof imageVariants>
function ImageRoot({ className, variant, size, children, ...props }: ImageRootProps) {
  return (
    <div
      data-slot="image-root"
      data-variant={variant}
      data-size={size}
      className={cn(imageVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  )
}
export type ImageSourceProps = {
  label?: string | undefined
  url?: string | undefined
  iconUrl?: string | undefined
} & React.ComponentProps<'div'>
function ImageSource({ className, label, url, iconUrl, ...props }: ImageSourceProps) {
  const href = safeHref(url)
  const host = hostOf(url)
  const displayLabel = label || host
  const [failedIconUrl, setFailedIconUrl] = useState<string | undefined>()
  if (!displayLabel) return null
  const showIcon = iconUrl !== undefined && failedIconUrl !== iconUrl
  return (
    <div
      data-slot="image-source"
      className={cn('text-muted-foreground flex items-center gap-2 border-t px-2 py-1.5 text-xs', className)}
      {...props}
    >
      {showIcon ? (
        <picture className="contents">
          <img
            data-slot="image-source-icon"
            src={iconUrl}
            alt=""
            className="size-4 shrink-0 rounded-sm"
            onError={() => setFailedIconUrl(iconUrl)}
          />
        </picture>
      ) : (
        <span
          data-slot="image-source-icon-fallback"
          aria-hidden="true"
          className="bg-muted flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-medium"
        >
          {displayLabel.charAt(0).toUpperCase()}
        </span>
      )}
      {href ? (
        <a
          data-slot="image-source-label"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground truncate"
        >
          {displayLabel}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span data-slot="image-source-label" className="truncate">
          {displayLabel}
        </span>
      )}
    </div>
  )
}
function ImageFilename({ className, children, ...props }: React.ComponentProps<'span'>) {
  if (!children) return null
  return (
    <span
      data-slot="image-filename"
      className={cn('text-muted-foreground block truncate px-2 py-1.5 text-xs', className)}
      {...props}
    >
      {children}
    </span>
  )
}
function ImageGenerating({ className }: { className?: string }) {
  return (
    <div
      data-slot="image-generating"
      className={cn('bg-muted/50 flex min-h-32 items-center justify-center p-4', className)}
    >
      <Loader2Icon className="text-muted-foreground size-8 animate-spin" />
      <span className="sr-only">Generating image…</span>
    </div>
  )
}
function ImageContentFilterError({ className, reason }: { className?: string; reason?: string }) {
  return (
    <div
      data-slot="image-content-filter-error"
      className={cn('bg-muted/50 flex min-h-32 flex-col items-center justify-center gap-2 p-4 text-center', className)}
    >
      <ShieldAlertIcon className="text-muted-foreground size-8" />
      <p className="text-sm font-medium">Image could not be generated</p>
      {reason && <p className="text-muted-foreground text-xs">{reason}</p>}
    </div>
  )
}
export type ImageActionsProps = {
  part: ImageMessagePart
  onRegenerate?: () => void | Promise<void>
  className?: string
}
function RegenerateButton({ onRegenerate }: { onRegenerate: () => void | Promise<void> }) {
  const [isRegenerating, setIsRegenerating] = useState(false)
  const runRegenerate = async () => {
    setIsRegenerating(true)
    try {
      await onRegenerate()
    } catch {
    } finally {
      setIsRegenerating(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => {
        void runRegenerate()
      }}
      disabled={isRegenerating}
      data-slot="image-regenerate"
      aria-label="Regenerate image"
      className="hover:bg-muted inline-flex size-7 items-center justify-center rounded disabled:opacity-50"
    >
      <RefreshCwIcon className={cn('size-4', isRegenerating && 'animate-spin')} />
    </button>
  )
}
function ImageActions({ part, onRegenerate, className }: ImageActionsProps) {
  return (
    <div data-slot="image-actions" className={cn('flex items-center gap-1 p-1', className)}>
      <button
        type="button"
        onClick={() => downloadImagePart(part)}
        data-slot="image-download"
        aria-label="Download image"
        className="hover:bg-muted inline-flex size-7 items-center justify-center rounded"
      >
        <DownloadIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          copyImagePart(part).catch(() => {})
        }}
        data-slot="image-copy"
        aria-label="Copy image"
        className="hover:bg-muted inline-flex size-7 items-center justify-center rounded"
      >
        <CopyIcon className="size-4" />
      </button>
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
    </div>
  )
}
const ImageImpl: ImageMessagePartComponent = (props) => {
  const { image, filename, status } = props
  if (status?.type === 'running') {
    return (
      <ImageRoot>
        <ImageGenerating />
        <ImageFilename>{filename}</ImageFilename>
      </ImageRoot>
    )
  }
  if (status?.type === 'incomplete' && status.reason === 'content-filter') {
    return (
      <ImageRoot>
        <ImageContentFilterError reason="The provider blocked this image." />
      </ImageRoot>
    )
  }
  return (
    <ImageRoot>
      <ImageZoom src={image} alt={filename || 'Image content'}>
        <ImagePreview src={image} alt={filename || 'Image content'} />
      </ImageZoom>
      <ImageFilename>{filename}</ImageFilename>
    </ImageRoot>
  )
}
const Image = Object.assign(memo(ImageImpl), {
  displayName: 'Image',
  Root: ImageRoot,
  Preview: ImagePreview,
  Source: ImageSource,
  Filename: ImageFilename,
  Zoom: ImageZoom,
  Actions: ImageActions,
  Generating: ImageGenerating,
  ContentFilterError: ImageContentFilterError,
})
export {
  Image,
  ImageRoot,
  ImagePreview,
  ImageSource,
  ImageFilename,
  ImageZoom,
  ImageActions,
  ImageGenerating,
  ImageContentFilterError,
  imageVariants,
}
