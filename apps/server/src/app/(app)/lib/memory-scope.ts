import type { DocumentChoice } from '../(shell)/memory/document-actions'

export type ScopeOption = { value: string; label: string; choice: DocumentChoice }
export type ScopeProduct = { id: number; name: string }

export const scopeOptions = (workspace: string, products: ScopeProduct[]): ScopeOption[] => [
  { value: 'factory', label: 'Factory', choice: { scope: 'factory' } },
  { value: 'workspace', label: `Workspace: ${workspace}`, choice: { scope: 'workspace' } },
  ...products.map((product) => ({
    value: `product-${product.id}`,
    label: `Product: ${product.name}`,
    choice: { scope: 'product', product: product.id } as const,
  })),
]

export const pickScope = (options: ScopeOption[], asked: string | undefined): ScopeOption | undefined =>
  options.find((option) => option.value === asked) ??
  options.find((option) => option.choice.scope === 'product') ??
  options[1]
