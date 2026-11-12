'use client'
import { ASKED } from '../../../../lib/workflow-labels'
import type { Addressee } from '../../../../lib/workflow-rules'
import { NativeSelect } from '../ui/native-select'

/** "Asked: Bauherr / Product owner": whom the checkpoint asks. A Bauherr or Admin can always decide in the Product owner's place. */
export function Asked({ what, value, onChange }: { what: string; value: Addressee; onChange: (by: Addressee) => void }) {
  return (
    <label className="small flex items-center gap-2">
      <span className="text-muted-foreground">Asked</span>
      <NativeSelect aria-label={`Asked: ${what}`} data-testid="asked" value={value} onChange={(e) => onChange(e.target.value as Addressee)} className="h-8 w-auto py-0 text-[13px]">
        {(['bauherr', 'product-owner'] as const).map((by) => <option key={by} value={by}>{ASKED[by]}</option>)}
      </NativeSelect>
    </label>
  )
}
