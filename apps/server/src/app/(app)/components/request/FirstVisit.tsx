import Link from 'next/link'
import { MermaidBlock } from '../ticket/MermaidBlock'
import { Button } from '../ui/button'

const FLOW = `flowchart LR
  A[You describe it] --> B[Factory asks a few questions]
  B --> C[Plan with pictures]
  C --> D[Built and tested]
  D --> E[You try it]
  E --> F[Live]
  Y((You and the factory's owner<br/>comment at any time)) -.-> C & D & E`

export function FirstVisit({ product, productId }: { product: string; productId: number }) {
  return (
    <section
      aria-labelledby="first-visit"
      className="flex flex-col items-center gap-4 border border-border bg-card px-6 py-12 text-center"
    >
      <h2 id="first-visit" className="heading">
        Tell the team what should change in {product}
      </h2>
      <p className="body max-w-[52ch]">
        Describe a problem or an idea in your own words. The factory asks what it needs, shows you the plan with
        pictures, builds it and lets you try it before it goes live. The person running the factory approves the plan
        and checks the result; you see their comments and they see yours.
      </p>
      <div className="w-full max-w-[760px] text-left">
        <MermaidBlock source={FLOW} />
      </div>
      <Button asChild>
        <Link href={`/requests/new?product=${productId}`}>Start your first request</Link>
      </Button>
    </section>
  )
}
