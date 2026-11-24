'use client'
import { useRouter } from 'next/navigation'
import { NativeSelect } from '../ui/native-select'

export function ScopeSelect({ value, options }: { value: string; options: { value: string; label: string }[] }) {
  const router = useRouter()
  return (
    <NativeSelect
      aria-label="Document"
      value={value}
      onChange={(event) => router.push(`/memory?scope=${event.target.value}`)}
      className="min-w-[220px]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  )
}
