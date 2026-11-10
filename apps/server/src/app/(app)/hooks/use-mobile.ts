import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = 768

/** True below 768px; false until mounted so server and first client render agree. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mql = matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const on = () => setMobile(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return mobile
}
