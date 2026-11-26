import { cn } from '@/lib/utils'

export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full bg-current animate-pulse-dot motion-reduce:animate-none',
        className,
      )}
    />
  )
}
