'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, type ComponentProps } from 'react'

const FROM_TEAM = 'bauherr:team-list'
/** The list's scroll offset when an agent was opened; the Sessions list scrolls back to it. */
export const LIST_SCROLL = 'bauherr:team-scroll'
const store = (fn: (s: Storage) => void) => {
  try {
    fn(sessionStorage)
  } catch {}
}

/** A link from the Team page to an agent; remembers that the visit started on the list, so Back returns to it as it was. */
export const AgentLink = (props: ComponentProps<typeof Link>) => <Link {...props} onClick={() =>
      store((s) => {
        s.setItem(FROM_TEAM, '1')
        s.setItem(LIST_SCROLL, `${scrollY}:${Date.now()}`)
      })
    } />

/** "Agent team": history back when the agent was opened from the list (toggle and scroll as they were), else a plain link. */
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

/** `/team#ses_<id>` (an old link) goes to `/team/<id>`: a hash never reaches the server. */
export function HashRedirect() {
  const router = useRouter()
  useEffect(() => {
    const id = /^#(ses_[\w-]+)$/.exec(location.hash)?.[1]
    if (id) router.replace(`/team/${id}`)
  }, [router])
  return null
}
