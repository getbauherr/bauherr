'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addMemoryAction } from '../../(shell)/memory/actions'
import type { MemoryProduct } from '../../../../core/views/statement-records'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { inputOf, MemoryFields, useDraft } from './MemoryFields'

export function AddMemoryForm({ products, product }: { products: MemoryProduct[]; product: number }) {
  const router = useRouter()
  const [chosen, setChosen] = useState(product)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const { draft, set } = useDraft({ text: '', reach: 'fit', area: '', stages: ['brief', 'build', 'review'] })
  const areas = products.find((entry) => entry.id === chosen)?.riskAreas ?? []
  const add = () =>
    start(async () => {
      const result = await addMemoryAction({ product: chosen, input: inputOf(draft) })
      if (result.error) return setError(result.error)
      router.push(`/memory/statements?product=${chosen}`)
    })
  return (
    <form onSubmit={(event) => event.preventDefault()} className="rounded-md border border-border bg-card">
      <div className="grid gap-5 p-6">
        <h1 className="heading m-0">Add a memory</h1>
        <MemoryFields
          draft={draft}
          set={set}
          reaches={['always', 'area', 'fit']}
          areas={areas}
          label="What should the factory remember?"
        />
        <div className="grid gap-1 sm:max-w-xs">
          <Label htmlFor="memory-product">Product</Label>
          <NativeSelect id="memory-product" value={chosen} onChange={(event) => setChosen(Number(event.target.value))}>
            {products.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <p className="small m-0 mr-auto text-muted-foreground">Active from the next run.</p>
        {error && <span role="alert" className="small text-destructive">{error}</span>}
        <Button asChild variant="outline">
          <Link href={`/memory/statements?product=${chosen}`}>Cancel</Link>
        </Button>
        <Button type="button" disabled={pending} onClick={add}>
          Add
        </Button>
      </div>
    </form>
  )
}
