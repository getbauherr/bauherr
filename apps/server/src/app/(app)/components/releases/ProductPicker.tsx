import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'

type Props = { products: { id: number; name: string }[]; product: number | null }

export function ProductPicker({ products, product }: Props) {
  if (products.length < 2) return null
  return (
    <form action="/releases" method="get" className="ml-auto flex items-center gap-2">
      <label htmlFor="releases-product" className="small text-muted-foreground">Product</label>
      <NativeSelect id="releases-product" name="product" defaultValue={product ?? ''} className="h-8">
        {products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </NativeSelect>
      <Button type="submit" variant="outline" size="sm">Show</Button>
    </form>
  )
}
