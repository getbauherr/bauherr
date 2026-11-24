'use client'
import { useFormStatus } from 'react-dom'
import { Button } from '../ui/button'

type Props = { action: (form: FormData) => Promise<void>; disabled: boolean }

export function StartButton({ action, disabled }: Props) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" formAction={action} formMethod="post" disabled={disabled || pending} className="w-fit">
      {pending ? 'Starting...' : 'Start Retro'}
    </Button>
  )
}
