import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import s from './avatars.module.css'

const PX = { sm: 32, md: 48, lg: 64, xl: 128 } as const
const TONES = [s.acc, s.ok, s.warn, s.bad] as const
const FILLS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--danger)'] as const
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
const initials = (id: string) => id.split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
const d = (v: string) => ({ '--d': v }) as React.CSSProperties

const Tile = () => <rect className={s.tile} x="1" y="1" width="62" height="62" rx="6" />

const NODES = [{ x: 14, y: 16, delay: '0s' }, { x: 50, y: 16, delay: '0.5s' }, { x: 32, y: 52, delay: '1s' }]

const art: Record<string, () => ReactNode> = {
  orchestrator: () => (
    <>
      {NODES.map((n) => (
        <path key={n.x} className={s.muted} d={`M32 32L${n.x} ${n.y}`} strokeDasharray="2 4" />
      ))}
      {NODES.map((n) => (
        <rect key={n.x} className={cn(s.paper, s.node)} style={d(n.delay)} x={n.x - 5} y={n.y - 5} width="10" height="10" rx="2" />
      ))}
      {NODES.map((n) => (
        <circle key={n.x} className={cn(s.accFill, s.token)} style={{ '--dx': n.x - 32, '--dy': n.y - 32, '--d': n.delay } as React.CSSProperties} cx={(32 + n.x) / 2} cy={(32 + n.y) / 2} r="2.5" />
      ))}
      <circle className={s.paper} cx="32" cy="32" r="8" />
      <circle className={s.accFill} cx="32" cy="32" r="3.5" />
    </>
  ),
  engineer: () => (
    <>
      <path className={s.acc} d="M17 20 8 32l9 12M47 20l9 12-9 12" />
      <path className={cn(s.ink, s.type)} style={d('0s')} d="M23 24h14" pathLength="1" />
      <path className={cn(s.ink, s.type)} style={d('0.3s')} d="M23 32h18" pathLength="1" />
      <path className={cn(s.ink, s.type)} style={d('0.6s')} d="M23 40h8" pathLength="1" />
      <rect className={cn(s.accFill, s.cursor)} x="34" y="37" width="3" height="6" />
    </>
  ),
  reviewer: () => (
    <>
      <path className={cn(s.ok, s.diff)} style={d('0s')} d="M10 22h24" />
      <path className={cn(s.ok, s.diff)} style={d('0.6s')} d="M10 32h18" />
      <path className={cn(s.ok, s.diff)} style={d('1.2s')} d="M10 42h22" />
      <g className={s.lens}>
        <circle className={s.paper} fillOpacity="0.35" cx="40" cy="26" r="9" />
        <path className={s.ink} d="m47 33 8 8" />
      </g>
    </>
  ),
  security: () => (
    <>
      <clipPath id="av-shield"><path d="M32 8 52 15v17c0 12-9 20-20 24C21 52 12 44 12 32V15Z" /></clipPath>
      <path className={s.paper} d="M32 8 52 15v17c0 12-9 20-20 24C21 52 12 44 12 32V15Z" />
      <g clipPath="url(#av-shield)"><path className={cn(s.acc, s.sweep)} d="M8 14h48" /></g>
      <path className={cn(s.ink, s.shackle)} d="M28 30v-5a4 4 0 0 1 8 0v5" />
      <rect className={s.ink} fill="var(--surface-100)" x="25" y="30" width="14" height="11" rx="2" />
    </>
  ),
  ux: () => (
    <>
      <rect className={s.paper} x="8" y="10" width="48" height="44" rx="4" />
      <rect className={s.muted} x="13" y="15" width="38" height="8" rx="2" />
      <rect className={cn(s.acc, s.swapL)} x="13" y="28" width="16" height="20" rx="2" />
      <rect className={cn(s.ink, s.swapR)} x="35" y="28" width="16" height="20" rx="2" />
      <path className={cn(s.pointer, s.accFill)} d="M16 38v10l3-2.5 3 5.5 2.5-1-3-5.5H27Z" stroke="var(--surface-100)" strokeWidth="1.5" strokeLinejoin="round" />
    </>
  ),
  test: () => (
    <>
      {[16, 32, 48].map((y, i) => (
        <g key={y}>
          <rect className={cn(i === 1 ? s.failBox : s.ink)} fill="var(--surface-100)" x="10" y={y - 6} width="11" height="11" rx="2" />
          {i === 1 ? (
            <>
              <path className={s.passTick} d="m12.5 31 3 3 5-6" pathLength="1" stroke="var(--ok)" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path className={cn(s.bad, s.failX)} d="m12.5 28.5 6 6M18.5 28.5l-6 6" pathLength="1" />
            </>
          ) : (
            <path className={cn(s.ok, s.tick)} style={d(i ? '1.6s' : '0s')} d={`m12.5 ${y - 1} 3 3 5-6`} pathLength="1" />
          )}
          <path className={s.muted} d={`M28 ${y}h${[24, 18, 21][i]}`} />
        </g>
      ))}
    </>
  ),
}

/** Character of a role. Each known `avatar` id has its own drawing; any other id gets initials on a shape. Motion is CSS only and only with `animate`. */
export function RoleAvatar({ avatar, size, animate }: { avatar: string; size: keyof typeof PX; animate: boolean }) {
  const draw = art[avatar]
  const h = hash(avatar)
  return (
    <svg className={cn(s.svg, animate && s.animate)} width={PX[size]} height={PX[size]} viewBox="0 0 64 64" aria-hidden focusable="false">
      <Tile />
      {draw ? draw() : (
        <>
          <rect className={cn(s.box, s.pulse)} x="9" y="9" width="46" height="46" rx={[6, 23, 6, 14][h % 4]} fill={FILLS[h % 4]} fillOpacity="0.16" />
          <rect className={TONES[h % 4]} x="12" y="12" width="40" height="40" rx={[6, 20, 6, 12][h % 4]} />
          <text className={s.text} x="32" y="33">{initials(avatar)}</text>
        </>
      )}
    </svg>
  )
}
