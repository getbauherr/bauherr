import { cn } from '@/lib/utils'
import { lineCount, linesOver } from '../../lib/memory-checks'
import { Button } from '../ui/button'

type Props = {
  body: string
  maxLines: number
  hint: string
  error: string | null
  saved: boolean
  disabled: boolean
  onSave: () => void
}

export function MemoryFooter({ body, maxLines, hint, error, saved, disabled, onSave }: Props) {
  const over = linesOver(body, maxLines)
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2.5">
      <span className={cn('mono', over > 0 ? 'text-destructive' : 'text-muted-foreground')}>
        {lineCount(body)} / {maxLines} lines
      </span>
      <span className="small text-muted-foreground">{hint}</span>
      {over > 0 && (
        <span role="alert" className="small text-destructive">
          {over} too many: keep it to {maxLines}.
        </span>
      )}
      {error && (
        <span role="alert" className="small text-destructive">
          {error}
        </span>
      )}
      {saved && (
        <span role="status" className="small text-muted-foreground">
          Saved
        </span>
      )}
      <Button type="button" className="ml-auto" disabled={disabled} onClick={onSave}>
        Save
      </Button>
    </div>
  )
}
