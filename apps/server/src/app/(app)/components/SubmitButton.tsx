'use client'
import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, className = 'btn', disabled = false }: { children: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus()
  return <button type="submit" className={className} disabled={pending || disabled}>{children}</button>
}
