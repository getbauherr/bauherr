import Link from 'next/link'

export function RunLink({ id, word = 'Run' }: { id: number; word?: string }) {
  return (
    <Link href={`/runs/${id}`} className="mono text-primary hover:underline">
      {word} {id}
    </Link>
  )
}
