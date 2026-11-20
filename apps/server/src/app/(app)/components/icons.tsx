// Icon paths from Lucide (https://lucide.dev, ISC license), inlined; the package is not a dependency.
import type { ReactNode } from 'react'

const icon = (children: ReactNode) =>
  function Icon({ className }: { className?: string }) {
    return (
      <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    )
  }

export const ChevronDown = icon(<path d="m6 9 6 6 6-6" />)
export const Sun = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2m-7.07-15.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </>,
)
export const Moon = icon(<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />)
export const Monitor = icon(
  <>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>,
)
export const LogOut = icon(<path d="m16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />)
export const Settings = icon(
  <>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </>,
)
export const Plus = icon(<path d="M5 12h14M12 5v14" />)
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />)
export const Check = icon(<path d="M20 6 9 17l-5-5" />)
export const ChevronRight = icon(<path d="m9 18 6-6-6-6" />)
export const ChevronsUpDown = icon(<path d="m7 15 5 5 5-5M7 9l5-5 5 5" />)
export const Search = icon(
  <>
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </>,
)
export const PanelLeft = icon(
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </>,
)
export const Ticket = icon(<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2" />)
export const Users = icon(<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />)
export const User = icon(<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0" />)
const FACTORY_BODY =
  'M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769' +
  '-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z'
const INBOX_BODY =
  'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24' +
  'a2 2 0 0 0-1.79 1.11z'

export const Factory = icon(
  <>
    <path d="M12 16h.01M16 16h.01M8 16h.01" />
    <path d={FACTORY_BODY} />
  </>,
)
export const Inbox = icon(
  <>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d={INBOX_BODY} />
  </>,
)
export const Clock = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
)
export const Ellipsis = icon(
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </>,
)
