import { redirect } from 'next/navigation'
import { requireBauherr } from '../../lib/session'

export default async function Settings() {
  await requireBauherr()
  redirect('/settings/profile')
}
