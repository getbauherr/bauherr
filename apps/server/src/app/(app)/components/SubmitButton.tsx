'use client'
import { useFormStatus } from 'react-dom'
import { Button } from './ui/button'

export function SubmitButton({ children, variant = 'outline', disabled = false, title }: { children: string; variant?: 'default' | 'outline'; disabled?: boolean; title?: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" variant={variant} disabled={pending || disabled} title={title}>{children}</Button>
}
