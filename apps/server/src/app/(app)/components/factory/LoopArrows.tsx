import { cn } from '@/lib/utils'

const LOOP = cn(
  'pointer-events-none absolute top-32.5 left-[calc(var(--col)*2.5+32px)]',
  'rounded-b-sm border border-t-0 border-dashed border-muted-foreground',
  "before:absolute before:-top-px before:-left-1 before:size-1.5 before:rotate-45 before:content-['']",
  'before:border-t-[1.5px] before:border-l-[1.5px] before:border-muted-foreground',
)
const LABEL = cn(
  'small absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2',
  'bg-background px-1.5 whitespace-nowrap text-muted-foreground',
)

export function LoopArrows({ verify, ship }: { verify: number; ship: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 max-md:hidden">
      <div className={cn(LOOP, 'h-3.5 w-[calc(var(--col)+16px)]')}>
        <span id="loop-verify" className={LABEL}>{verify} sent back from Verify</span>
      </div>
      <div className={cn(LOOP, 'h-8.5 w-[calc(var(--col)*2+32px)]')}>
        <span id="loop-ship" className={LABEL}>{ship} sent back from Ship this week</span>
      </div>
    </div>
  )
}
