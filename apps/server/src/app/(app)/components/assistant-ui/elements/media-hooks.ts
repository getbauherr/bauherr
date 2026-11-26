import { useEffect, useRef, useState, type RefObject } from 'react'
import { canPreload } from '../utils/href'

export function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(wholeSeconds / 60)
  const remainingSeconds = wholeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}
export function useDeferredSource(
  mediaRef: RefObject<HTMLMediaElement | null>,
  src: string,
  mediaOrigins: readonly string[] | undefined,
) {
  const preload = canPreload(src, mediaOrigins)
  const [armedSrc, setArmedSrc] = useState<string | undefined>(undefined)
  if (armedSrc !== undefined && armedSrc !== src) setArmedSrc(undefined)
  const armed = preload || armedSrc === src
  const wasArmed = useRef(armed)
  useEffect(() => {
    const media = mediaRef.current
    if (media && !armed && (wasArmed.current || media.hasAttribute('src'))) {
      media.removeAttribute('src')
      media.load()
    }
    wasArmed.current = armed
  }, [mediaRef, src, armed])
  return {
    preload,
    armed,
    arm: () => {
      const media = mediaRef.current
      if (!media || armed) return
      media.src = src
      setArmedSrc(src)
    },
  }
}
export function useMediaDuration(mediaRef: RefObject<HTMLMediaElement | null>, src: string, durationMs?: number) {
  const [metadata, setMetadata] = useState<{
    src: string
    duration?: number
  }>({
    src,
  })
  useEffect(() => {
    const media = mediaRef.current
    if (!media || media.readyState < HTMLMediaElement.HAVE_METADATA) return
    if (Number.isFinite(media.duration) && media.duration >= 0) {
      setMetadata({ src, duration: media.duration })
    }
  }, [mediaRef, src])
  const fallbackDuration =
    durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(0, durationMs / 1000) : undefined
  return {
    duration: metadata.src === src ? (metadata.duration ?? fallbackDuration) : fallbackDuration,
    setDurationFromMetadata: (duration: number) => {
      if (Number.isFinite(duration) && duration >= 0) {
        setMetadata({ src, duration })
      }
    },
  }
}
