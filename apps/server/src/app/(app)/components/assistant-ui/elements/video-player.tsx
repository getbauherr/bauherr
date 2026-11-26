'use client'

import { useRef, type ComponentProps, type RefObject } from 'react'
import { PlayIcon } from 'lucide-react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import { field, inkButton, mono } from './surfaces'
import { canPreload } from '../utils/href'
import { formatDuration, useDeferredSource, useMediaDuration } from './media-hooks'

export interface VideoPlayerProps extends Omit<ComponentProps<'div'>, 'children'> {
  src: string
  poster?: string | undefined
  title?: string | undefined
  ratio?: '16:9' | '4:3' | '1:1' | '9:16' | 'auto' | undefined
  durationMs?: number | undefined
  mediaOrigins?: readonly string[] | undefined
}

const RATIO_CLASS = {
  '1:1': 'aspect-square',
  '4:3': 'aspect-[4/3]',
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
}

function PlayOverlay({
  title,
  videoRef,
  source,
}: {
  title: string | undefined
  videoRef: RefObject<HTMLVideoElement | null>
  source: ReturnType<typeof useDeferredSource>
}) {
  return (
    <button
      type="button"
      aria-label={`Play ${title ?? 'video'}`}
      onClick={() => {
        flushSync(() => source.arm())
        videoRef.current?.focus()
        void videoRef.current?.play().catch(() => {})
      }}
      className="absolute inset-0 flex items-center justify-center"
    >
      <span className={cn(inkButton, 'flex size-11 items-center justify-center rounded-full')}>
        <PlayIcon aria-hidden className="ml-0.5 size-5" />
      </span>
    </button>
  )
}

function VideoCaption({ title, duration }: { title: string | undefined; duration: number | undefined }) {
  if (!title && duration === undefined) return null
  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      {title ? <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{title}</span> : null}
      {duration !== undefined ? (
        <span className={cn(mono, 'text-muted-foreground shrink-0 tabular-nums')}>{formatDuration(duration)}</span>
      ) : null}
    </div>
  )
}

export function VideoPlayer({
  src,
  poster,
  title,
  ratio = '16:9',
  durationMs,
  mediaOrigins,
  className,
  ...props
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const source = useDeferredSource(videoRef, src, mediaOrigins)
  const { duration, setDurationFromMetadata } = useMediaDuration(videoRef, src, durationMs)
  const ratioClassName = ratio === 'auto' ? undefined : RATIO_CLASS[ratio]
  return (
    <div data-slot="video-player" className={cn('flex w-full max-w-xl flex-col gap-2', className)} {...props}>
      <div className={cn(field, 'relative overflow-hidden rounded-xl', ratioClassName)}>
        <video
          ref={videoRef}
          src={source.preload ? src : undefined}
          poster={canPreload(poster, mediaOrigins) ? poster : undefined}
          controls={source.armed}
          playsInline
          preload={source.preload ? 'metadata' : 'none'}
          aria-label={title ?? 'Video'}
          className={cn('block max-w-full', ratio !== 'auto' && 'h-full w-full object-contain')}
          onLoadedMetadata={(event) => {
            setDurationFromMetadata(event.currentTarget.duration)
          }}
        />
        {source.armed ? null : <PlayOverlay title={title} videoRef={videoRef} source={source} />}
      </div>
      <VideoCaption title={title} duration={duration} />
    </div>
  )
}
