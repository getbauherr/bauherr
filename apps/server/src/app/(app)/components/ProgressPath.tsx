import { PATH } from '../../../lib/progress'

/** The six plain steps of a request with the current one marked; `large` for the request page. A request that ended without a change has no path. */
export function ProgressPath({ step, large }: { step: number | null; large?: boolean }) {
  if (step === null) return null
  return (
    <ol className={`m-0 flex list-none flex-wrap items-center p-0 ${large ? 'gap-x-3 gap-y-2' : 'gap-x-2 gap-y-1'}`} aria-label="Progress" data-testid="progress-path" data-step={step}>
      {PATH.map((label, i) => (
        <li key={label} className={`flex items-center gap-1.5 ${i === step ? 'font-medium text-foreground' : i < step ? 'text-foreground' : 'text-muted-foreground'} ${large ? 'body' : 'small'}`} aria-current={i === step ? 'step' : undefined} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
          <span aria-hidden className={`rounded-full ${large ? 'size-3' : 'size-2'} ${i < step ? 'bg-ok' : i === step ? 'bg-primary ring-2 ring-primary/30' : 'border border-border'}`} />
          {label}
          {large && i < PATH.length - 1 && <span aria-hidden className="ml-1 h-px w-3 bg-border" />}
        </li>
      ))}
    </ol>
  )
}
