'use client'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from './ui/button'

/**
 * The one button of the bar: `onClick`, `href` or the `id` of a form to submit. `disabled` keeps it visible and gives `reason` as tooltip and
 * description. `confirm` makes it two clicks (the first arms it, a Cancel button appears).
 */
export type NextStepPrimary = { label: string; disabled?: boolean; reason?: string; onClick?: () => void; href?: string; newTab?: boolean; form?: string; confirm?: string }

/** `reason` with each `#N` / `Run N` token that has an entry in `links` rendered as that link; other tokens stay text. */
export function LinkedReason({ reason, links }: { reason: string; links: { text: string; href: string }[] }) {
  return reason.split(/(#\d+|Run \d+)/).map((part, i) => {
    const link = links.find((l) => l.text === part)
    return link ? <a key={i} className="text-primary" href={link.href}>{part}</a> : part
  })
}

/** Put inside a form that a primary submits with `form`: tells the bar while the server action runs, so the button is disabled at once. */
export function FormPending() {
  const { pending } = useFormStatus()
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    ref.current?.closest('form')?.dispatchEvent(new CustomEvent('formpending', { detail: pending }))
  }, [pending])
  return <span ref={ref} hidden />
}

/** The frame of the one place the owner acts on a page: sentence left, `children` then the primary button right, sticky at the top on desktop, fixed to the bottom at 640px and below. `main` pads for it (`--next-step-h`). */
export function NextStepBar({ sentence, primary, children }: { sentence: ReactNode; primary?: NextStepPrimary; children?: ReactNode }) {
  const uid = useId()
  const [armed, setArmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const formId = primary?.form
  useEffect(() => {
    const form = formId ? document.getElementById(formId) : null
    if (!form) return
    const on = (e: Event) => setSubmitting((e as CustomEvent<boolean>).detail)
    form.addEventListener('formpending', on)
    return () => form.removeEventListener('formpending', on)
  }, [formId])
  const p = primary
  const button = !p ? null : p.href ? (
    <Button asChild><a href={p.href} {...(p.newTab ? { target: '_blank', rel: 'noreferrer' } : {})}>{p.label}</a></Button>
  ) : (
    <span title={p.disabled ? p.reason : undefined} className="contents">
      {armed && !p.disabled && <Button type="button" variant="outline" onClick={() => setArmed(false)}>Cancel</Button>}
      <Button
        type={p.form ? 'submit' : 'button'}
        form={p.form}
        disabled={p.disabled || submitting}
        aria-describedby={p.disabled && p.reason ? `${uid}-r` : undefined}
        onClick={(e) => {
          if (p.confirm && !armed) {
            e.preventDefault()
            setArmed(true)
          } else p.onClick?.()
        }}
      >
        {submitting ? 'Working…' : armed && p.confirm ? p.confirm : p.label}
      </Button>
      {p.disabled && p.reason && <span id={`${uid}-r`} className="sr-only">{p.reason}</span>}
    </span>
  )
  return (
    <div
      ref={(el) => {
        if (!el) return
        const set = () => document.documentElement.style.setProperty('--next-step-h', `${el.offsetHeight}px`)
        set()
        const ro = new ResizeObserver(set)
        ro.observe(el)
        return () => {
          ro.disconnect()
          document.documentElement.style.removeProperty('--next-step-h')
        }
      }}
      className="sticky top-0 z-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-md border border-border bg-card px-4 py-3 text-card-foreground max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:flex-col max-sm:items-stretch max-sm:rounded-none max-sm:border-0 max-sm:border-t max-sm:pb-[calc(var(--space-3)+env(safe-area-inset-bottom))] max-sm:min-h-11 max-sm:[&_[data-slot=button]]:min-h-11 [&_form]:contents"
      data-testid="action-bar"
      role="region"
      aria-label="Next step"
    >
      <p className="min-w-0 flex-[1_1_20ch] text-pretty max-sm:flex-none">{sentence}</p>
      {(children || button) && <div className="flex flex-wrap items-center gap-3 max-sm:justify-end">{children}{button}</div>}
    </div>
  )
}
