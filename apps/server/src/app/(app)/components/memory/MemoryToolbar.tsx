'use client'
import type { EditorView } from '@codemirror/view'
import { Bold, Code, Italic, Link, List, ListOrdered, SquareCode, type LucideIcon } from 'lucide-react'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import { SECTIONS } from '../../../../core/memory-sections'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TOOLS } from './editor-commands'
import { Button } from '../ui/button'

const ICONS: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  code: Code,
  'code-block': SquareCode,
  bullets: List,
  numbers: ListOrdered,
  link: Link,
}
const GROUPS = [['bold', 'italic', 'code', 'code-block'], ['bullets', 'numbers'], ['link']]

type Props = { view: RefObject<EditorView | null>; disabled: boolean }

export function MemoryToolbar({ view, disabled }: Props) {
  const press = (run: (typeof TOOLS)[number]['run']) => {
    const target = view.current
    if (!target) return
    run(target)
    target.focus()
  }
  return (
    <>
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-1 border-b border-border px-3 py-2">
        {GROUPS.map((group, index) => (
          <div key={group.join()} className={cn('flex gap-1', index > 0 && 'ml-1.5 border-l border-border pl-2.5')}>
            {TOOLS.filter((tool) => group.includes(tool.id)).map((tool) => {
              const Icon = ICONS[tool.id] ?? Bold
              return (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={tool.label}
                      aria-keyshortcuts={tool.shortcut?.replace('Ctrl', 'Control')}
                      onClick={() => press(tool.run)}
                      className={cn(
                        'rounded-md text-foreground hover:bg-secondary',
                        'disabled:cursor-not-allowed disabled:text-muted-foreground',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {tool.label}
                    {tool.shortcut && <b className="mono ml-1.5 font-normal text-muted-foreground">{tool.shortcut}</b>}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-background px-3 py-2">
        <span className="small text-muted-foreground">Headings are fixed:</span>
        {SECTIONS.map((section) => (
          <Badge key={section}>{section}</Badge>
        ))}
      </div>
    </>
  )
}
