'use client'
import { useRouter } from 'next/navigation'
import { IntakeChat } from '../IntakeChat'

/** Step 5, second tab: the intake chat; once the request is sent the wizard shows its finish screen. */
export function IntakeStep(props: { userId: number; products: { id: number; name: string }[] }) {
  const router = useRouter()
  return <IntakeChat {...props} onSent={() => router.push('/setup')} />
}
