'use client'
import { useTransition } from 'react'
import { chooseRequestProduct } from '../../(shell)/requests/actions'
import { Check, ChevronDown } from '../icons'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = { products: { id: number; name: string }[]; current: number }

export function ProductSwitcher({ products, current }: Props) {
  const [pending, start] = useTransition()
  const shown = products.find((p) => p.id === current)
  if (products.length < 2) return shown ? <Badge variant="outline">{shown.name}</Badge> : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={`Product ${shown?.name}`}>
          {shown?.name}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Product</DropdownMenuLabel>
        {products.map((p) => (
          <DropdownMenuItem
            key={p.id}
            aria-current={p.id === current}
            disabled={pending}
            onSelect={() => start(() => chooseRequestProduct(p.id))}
          >
            {p.name}
            {p.id === current && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
