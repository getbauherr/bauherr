'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

export function InboxAdvance({ waiting, selected }: { waiting: number[]; selected: number | null }) {
  const router = useRouter()
  const key = waiting.join(',')
  const before = useRef(key)

  useEffect(() => {
    const was = before.current.split(',').filter(Boolean).map(Number)
    const now = key.split(',').filter(Boolean).map(Number)
    before.current = key
    if (selected === null || now.includes(selected) || !was.includes(selected)) return
    const at = was.indexOf(selected)
    const next = [...was.slice(at + 1), ...was.slice(0, at).reverse()].find((id) => now.includes(id))
    router.replace(next === undefined ? '/inbox' : `/inbox?t=${next}`, { scroll: false })
  }, [key, selected, router])

  return null
}
