import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...p} className={`btn ${variant === 'secondary' ? '' : variant} ${className}`} />
}
