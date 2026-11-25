'use client'
import { useRouter } from 'next/navigation'
import { NativeSelect } from '../ui/native-select'

export function ProductPicker({ products, current }: { products: { id: number; name: string }[]; current: number }) {
  const router = useRouter()
  return (
    <NativeSelect
      aria-label="Product"
      value={current}
      onChange={(event) => router.push(`/requests?product=${event.target.value}`)}
    >
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  )
}
