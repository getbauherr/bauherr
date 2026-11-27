'use client'
import { useEffect, useRef } from 'react'

const GAP = 16

export function useStickyTop<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const place = () => {
      const top = Math.min(GAP, window.innerHeight - node.offsetHeight - GAP)
      node.style.top = `${top}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(node)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])
  return ref
}
