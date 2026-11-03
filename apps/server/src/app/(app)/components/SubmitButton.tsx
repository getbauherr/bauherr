'use client'
import { useFormStatus } from 'react-dom'
import { Button } from './ui/button'

/** `className` still carries the legacy `btn primary` classes of the Ticket page callers until they migrate. */
export function SubmitButton({ children, className, disabled = false }: { children: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus()
  return <Button type="submit" variant="outline" className={className} disabled={pending || disabled}>{children}</Button>
}
