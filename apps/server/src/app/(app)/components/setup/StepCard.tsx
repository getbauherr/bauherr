import Link from 'next/link'
import type { ReactNode } from 'react'
import { SettingsSection } from '../SettingsParts'

export function StepCard({ id, n, title, purpose, later, children }: { id: string; n: number; title: string; purpose: string; later: { text: string; href: string; label: string }; children: ReactNode }) {
  return (
    <SettingsSection id={id} n={n} title={title} purpose={purpose}>
      {children}
      <p className="small text-muted-foreground">{later.text} <Link className="text-primary" href={later.href}>{later.label}</Link></p>
    </SettingsSection>
  )
}
