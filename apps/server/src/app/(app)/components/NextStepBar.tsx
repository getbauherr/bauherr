'use client'
import Link from 'next/link'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from './ui/button'

export type NextStepPrimary = {
  label: string
  disabled?: boolean
  reason?: string
  onClick?: () => void
  href?: string
  newTab?: boolean
  form?: string
  confirm?: string
}

export function LinkedReason({ reason, links }: { reason: string; links: { text: string; href: string }[] }) {
  return reason.split(/(#\d+|Run \d+)/).map((part, i) => {
    const link = links.find((l) => l.text === part)
    return link ? (
      <Link key={i} className="text-primary" href={link.href}>
        {part}
      </Link>
    ) : (
      part
    )
  })
}

export function FormPending() {
  const { pending } = useFormStatus()
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    ref.current?.closest('form')?.dispatchEvent(new CustomEvent('formpending', { detail: pending }))
  }, [pending])
  return <span ref={ref} hidden />
}

type ButtonState = {
  uid: string
  armed: boolean
  setArmed: (armed: boolean) => void
  submitting: boolean
}

function LinkButton({ p }: { p: NextStepPrimary & { href: string } }) {
  return (
    <Button asChild>
      <Link href={p.href} {...(p.newTab ? { target: '_blank', rel: 'noreferrer' } : {})}>
        {p.label}
      </Link>
    </Button>
  )
}

const labelOf = (p: NextStepPrimary, armed: boolean, submitting: boolean) =>
  submitting ? 'Working…' : armed && p.confirm ? p.confirm : p.label

function DisabledReason({ p, uid }: { p: NextStepPrimary; uid: string }) {
  return p.disabled && p.reason ? (
    <span id={`${uid}-r`} className="sr-only">
      {p.reason}
    </span>
  ) : null
}

function ActionButton({ p, uid, armed, setArmed, submitting }: ButtonState & { p: NextStepPrimary }) {
  return (
    <span title={p.disabled ? p.reason : undefined} className="contents">
      {armed && !p.disabled && (
        <Button type="button" variant="outline" onClick={() => setArmed(false)}>
          Cancel
        </Button>
      )}
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
        {labelOf(p, armed, submitting)}
      </Button>
      <DisabledReason p={p} uid={uid} />
    </span>
  )
}

function PrimaryButton({ p, ...state }: ButtonState & { p: NextStepPrimary }) {
  return p.href ? <LinkButton p={{ ...p, href: p.href }} /> : <ActionButton p={p} {...state} />
}

const trackBarHeight = (el: HTMLDivElement | null) => {
  if (!el) return
  const set = () => document.documentElement.style.setProperty('--next-step-h', `${el.offsetHeight}px`)
  set()
  const ro = new ResizeObserver(set)
  ro.observe(el)
  return () => {
    ro.disconnect()
    document.documentElement.style.removeProperty('--next-step-h')
  }
}

export function NextStepBar({
  sentence,
  primary,
  children,
  live,
}: {
  sentence: ReactNode
  primary?: NextStepPrimary
  children?: ReactNode
  live?: boolean
}) {
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
  const button = primary ? (
    <PrimaryButton p={primary} uid={uid} armed={armed} setArmed={setArmed} submitting={submitting} />
  ) : null
  return (
    <div
      ref={(el) => trackBarHeight(el)}
      className={
        'sticky top-0 z-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ' +
        'rounded-md border border-border bg-card px-4 py-3 text-card-foreground ' +
        'max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:flex-col ' +
        'max-sm:items-stretch max-sm:rounded-none max-sm:border-0 max-sm:border-t ' +
        'max-sm:pb-[calc(var(--space-3)+env(safe-area-inset-bottom))] max-sm:min-h-11 ' +
        'max-sm:[&_[data-slot=button]]:min-h-11 [&_form]:contents'
      }
      data-testid="action-bar"
      role="region"
      aria-label="Next step"
    >
      <p role={live ? 'status' : undefined} className="min-w-0 flex-[1_1_20ch] text-pretty max-sm:flex-none">
        {sentence}
      </p>
      {(children || button) && (
        <div className="flex flex-wrap items-center gap-3 max-sm:justify-end">
          {children}
          {button}
        </div>
      )}
    </div>
  )
}
