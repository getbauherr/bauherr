'use client'
import { AttachmentPrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react'
import type { FC } from 'react'
import { ArrowUp, X } from '@/components/icons'
import { Paperclip, Stop } from '../chat/icons'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { CostMeter } from '../assistant-ui/elements/cost-meter'
import { ModelSelectorContent, ModelSelectorRoot, ModelSelectorTrigger } from '../assistant-ui/elements/model-selector'
import { formatTokenCount } from '../assistant-ui/utils/tokens'
import type { View } from '../../../../lib/refine/engine'
import { TIERS, type Tier } from '../../../../lib/refine/model'

const LABEL: Record<Tier, string> = { cheap: 'Cheap', standard: 'Standard', strong: 'Strong' }
export const usd = (v: number): string => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`

/** A pasted or dropped screenshot in the composer: its thumbnail (the upload already ran) and a remove button. */
const Thumb: FC = () => {
  const src = useAuiState((s) => {
    const part = s.attachment.content?.find((p) => p.type === 'image')
    return part && 'image' in part ? part.image : undefined
  })
  const error = useAuiState((s) => (s.attachment.status.type === 'incomplete' ? ((s.attachment.status as { message?: string }).message ?? 'Upload failed') : null))
  return (
    <AttachmentPrimitive.Root data-testid="attachment" title={error ?? undefined} data-error={!!error} className="relative size-14 overflow-hidden rounded-md border border-border bg-secondary data-[error=true]:border-destructive">
      {src ? <img src={src} alt="Screenshot to send" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-[11px] text-muted-foreground">{error ? '!' : '...'}</span>}
      <AttachmentPrimitive.Remove asChild>
        <button type="button" aria-label="Remove attachment" className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground"><X className="size-3" /></button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  )
}

/** Tokens and cost of the conversation so far; a click opens the breakdown per turn. "unpriced" when a turn's model has no catalog price. */
const CostChip: FC<{ cost: View['cost'] }> = ({ cost }) => {
  const label = cost.usd === null ? 'unpriced' : usd(cost.usd)
  const total = cost.turns.reduce((n, t) => n + (t.usd ?? 0), 0)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="cost-chip" aria-label="Cost and tokens of this conversation" className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 font-mono text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <span>{label}</span>
          <span aria-hidden>·</span>
          <span>{formatTokenCount(cost.tokens)} tokens</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-96 border-0 bg-transparent p-0">
        <CostMeter
          total={label}
          tokens={`${formatTokenCount(cost.tokens)} tokens`}
          lines={cost.turns.map((t, i) => ({ label: `Turn ${i + 1} · ${t.model}`, inputTokens: t.tokensIn, outputTokens: t.tokensOut, cost: t.usd === null ? 'unpriced' : usd(t.usd), share: total > 0 && t.usd ? t.usd / total : 0 }))}
        />
        {cost.turns.length === 0 && <p className="m-0 mt-2 rounded-md border border-border bg-card p-3 text-[13px] text-muted-foreground">No model turn yet.</p>}
      </PopoverContent>
    </Popover>
  )
}

/** The composer: attach (images, also pasted or dropped), the model of this conversation, the cost chip, send or stop. */
export const Composer: FC<{ view: View; placeholder: string; streaming: boolean; onStop(): void; onModel(tier: Tier): void }> = ({ view, placeholder, streaming, onStop, onModel }) => (
  <ComposerPrimitive.Root className="rounded-lg border border-border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring">
    <ComposerPrimitive.AttachmentDropzone className="flex flex-col gap-1 rounded-lg p-2 data-[dragging=true]:bg-accent">
      <div className="flex flex-wrap gap-2 px-1 empty:hidden">
        <ComposerPrimitive.Attachments>{() => <Thumb />}</ComposerPrimitive.Attachments>
      </div>
      <ComposerPrimitive.Input rows={1} maxRows={6} style={{ outline: 'none' }} aria-label="Your answer" placeholder={placeholder} className="max-h-40 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-[15px]" />
      <div className="flex items-center gap-1">
        <ComposerPrimitive.AddAttachment asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-muted-foreground"><Paperclip size={16} />Attach</Button>
        </ComposerPrimitive.AddAttachment>
        <ModelSelectorRoot models={TIERS.map((t) => ({ id: t, name: view.models.find((m) => m.tier === t)!.model, description: `${LABEL[t]} tier` }))} value={view.tier} onValueChange={(t) => onModel(t as Tier)}>
          <ModelSelectorTrigger variant="ghost" size="sm" data-testid="model-chip" className="font-mono text-[12px] text-muted-foreground" />
          <ModelSelectorContent searchable={false} side="top" />
        </ModelSelectorRoot>
        <span className="ms-auto flex items-center gap-1">
          <CostChip cost={view.cost} />
          {streaming ? (
            <Button type="button" size="icon" aria-label="Stop" data-testid="stop" className="size-8" onClick={onStop}><Stop /></Button>
          ) : (
            <ComposerPrimitive.Send asChild><Button type="submit" size="icon" aria-label="Send" className="size-8"><ArrowUp /></Button></ComposerPrimitive.Send>
          )}
        </span>
      </div>
    </ComposerPrimitive.AttachmentDropzone>
  </ComposerPrimitive.Root>
)
