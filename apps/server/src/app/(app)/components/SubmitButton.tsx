'use client'
import { useFormStatus } from 'react-dom'
import { Button } from './ui/button'

export function SubmitButton({ children, variant = 'outline', disabled = false }: { children: string; variant?: 'default' | 'outline'; disabled?: boolean }) {
  const { pending } = useFormStatus()
  return <Button type="submit" variant={variant} disabled={pending || disabled}>{children}</Button>
}
