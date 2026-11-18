'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, type ComponentProps } from 'react'

const FROM_TEAM = 'bauherr:team-list'
export const LIST_SCROLL = 'bauherr:team-scroll'
const store = (fn: (s: Storage) => void) => {
  try {
    fn(sessionStorage)
  } catch {}
}

export const AgentLink = (props: ComponentProps<typeof Link>) => <Link {...props} onClick={() =>
      store((s) => {
        s.setItem(FROM_TEAM, '1')
        s.setItem(LIST_SCROLL, `${scrollY}:${Date.now()}`)
      })
    } />

export function BackLink({ className }: { className?: string }) {
  const router = useRouter()
  return (
    <Link
      href="/team"
      className={className}
      onClick={(e) => {
        let from = false
        store((s) => {
          from = s.getItem(FROM_TEAM) === '1'
          s.removeItem(FROM_TEAM)
          if (!from) s.removeItem(LIST_SCROLL)
        })
        if (from && !e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          router.back()
        }
      }}
    >
      Agent team
    </Link>
  )
}

export function HashRedirect() {
  const router = useRouter()
  useEffect(() => {
    const id = /^#(ses_[\w-]+)$/.exec(location.hash)?.[1]
    if (id) router.replace(`/team/${id}`)
  }, [router])
  return null
}
