'use client'

import { useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { PauseIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inkButton, mono, paper } from './surfaces'
import { canPreload } from '../utils/href'
import { formatDuration, useDeferredSource, useMediaDuration } from './media-hooks'

export interface AudioPlayerProps extends Omit<ComponentProps<'div'>, 'children'> {
  src: string
  title?: string | undefined
  artwork?: string | undefined
  durationMs?: number | undefined
  mediaOrigins?: readonly string[] | undefined
}

const initialPlayback = (src: string) => ({ src, currentTime: 0, playing: false, hasError: false })
type Playback = ReturnType<typeof initialPlayback>

function usePlayback(
  audioRef: RefObject<HTMLAudioElement | null>,
  src: string,
  source: ReturnType<typeof useDeferredSource>,
) {
  const [playback, setPlayback] = useState(initialPlayback(src))
  const state = playback.src === src ? playback : initialPlayback(src)
  const update = (patch: Partial<Omit<Playback, 'src'>>) =>
    setPlayback((current) => ({
      ...(current.src === src ? current : initialPlayback(src)),
      ...patch,
    }))
  useEffect(() => {
    if (audioRef.current?.error) {
      setPlayback({ ...initialPlayback(src), hasError: true })
    }
  }, [audioRef, src])
  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio || state.hasError) return
    if (state.playing) {
      audio.pause()
      update({ playing: false })
      return
    }
    source.arm()
    void audio.play().then(
      () => update({ playing: true }),
      () => update(audio.error ? { hasError: true, playing: false } : { playing: false }),
    )
  }
  const seek = (nextTime: number, duration: number | undefined) => {
    if (!Number.isFinite(nextTime)) return
    const resolvedTime = Math.min(nextTime, duration ?? nextTime)
    if (audioRef.current) audioRef.current.currentTime = resolvedTime
    update({ currentTime: resolvedTime })
  }
  return { ...state, update, togglePlayback, seek }
}

function PlayButton({
  playing,
  label,
  disabled,
  onClick,
}: {
  playing: boolean
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`${playing ? 'Pause' : 'Play'}${label}`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        inkButton,
        'flex size-9 shrink-0 items-center justify-center rounded-full disabled:cursor-default disabled:opacity-40',
      )}
    >
      {playing ? <PauseIcon aria-hidden className="size-4" /> : <PlayIcon aria-hidden className="ml-0.5 size-4" />}
    </button>
  )
}

function SeekBar({
  currentTime,
  duration,
  durationLabel,
  disabled,
  onSeek,
}: {
  currentTime: number
  duration: number | undefined
  durationLabel: string
  disabled: boolean
  onSeek: (time: number) => void
}) {
  return (
    <input
      type="range"
      min={0}
      max={duration ?? 0}
      step={0.1}
      value={Math.min(currentTime, duration ?? 0)}
      aria-label="Seek"
      aria-valuetext={`${formatDuration(currentTime)} of ${durationLabel}`}
      disabled={disabled}
      onChange={(event) => onSeek(Number(event.currentTarget.value))}
      className="accent-foreground w-full"
    />
  )
}

export function AudioPlayer({ src, title, artwork, durationMs, mediaOrigins, className, ...props }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const source = useDeferredSource(audioRef, src, mediaOrigins)
  const { duration, setDurationFromMetadata } = useMediaDuration(audioRef, src, durationMs)
  const { currentTime, playing, hasError, update, togglePlayback, seek } = usePlayback(audioRef, src, source)
  const durationLabel = duration === undefined ? '--:--' : formatDuration(duration)
  return (
    <div
      data-slot="audio-player"
      className={cn(paper, 'flex w-full max-w-md items-center gap-3 rounded-2xl p-3', className)}
      {...props}
    >
      {canPreload(artwork, mediaOrigins) ? (
        <picture className="contents">
          <img src={artwork} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
        </picture>
      ) : null}
      <PlayButton
        playing={playing}
        label={title ? ` ${title}` : ' audio'}
        disabled={hasError}
        onClick={togglePlayback}
      />
      <div className="flex min-w-0 grow basis-16 flex-col gap-1.5">
        <span className="truncate text-[13.5px] font-medium">{title ?? 'Audio'}</span>
        <SeekBar
          currentTime={currentTime}
          duration={duration}
          durationLabel={durationLabel}
          disabled={hasError}
          onSeek={(time) => seek(time, duration)}
        />
      </div>
      <span className={cn(mono, 'text-muted-foreground tabular-nums')}>
        {formatDuration(currentTime)}&nbsp;/ {durationLabel}
      </span>
      <audio
        ref={audioRef}
        src={source.preload ? src : undefined}
        preload={source.preload ? 'metadata' : 'none'}
        className="hidden"
        onLoadedMetadata={(event) => {
          setDurationFromMetadata(event.currentTarget.duration)
        }}
        onTimeUpdate={(event) => update({ currentTime: event.currentTarget.currentTime })}
        onPlay={() => update({ playing: true })}
        onPause={() => update({ playing: false })}
        onError={() => update({ hasError: true, playing: false })}
      />
      {hasError ? (
        <span role="alert" className="text-muted-foreground text-xs">
          Can&apos;t play this audio
        </span>
      ) : null}
    </div>
  )
}
