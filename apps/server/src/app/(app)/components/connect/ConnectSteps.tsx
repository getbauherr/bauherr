import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FirstLook } from '../../../../core/views/first-look'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { type Phase, stepState } from '../../lib/connect-phase'
import { formatCount } from '../product/MirrorState'
import { CHECK_MARK } from './marks'

type Props = { product: ProductSettings; look: FirstLook; phase: Phase }

const mono = (text: string) => <span className="mono">{text}</span>

function Connect({ product, phase }: { product: ProductSettings; phase: Phase }) {
  if (phase === 1) {
    return (
      <Link href={`/settings/products/${product.id}#repository`} className="text-primary underline underline-offset-2">
        Add a repository to this Product.
      </Link>
    )
  }
  const n = product.sources.length
  return <>{n === 1 ? 'One repository attached' : `${n} repositories attached`}</>
}

function Import({ look, phase }: { look: FirstLook; phase: Phase }) {
  const { issuesMirrored, pullRequestsMirrored } = look.repository
  const counts = (
    <>
      {mono(formatCount(issuesMirrored))} issues, {mono(formatCount(pullRequestsMirrored))} pull requests
    </>
  )
  if (phase === 1) return <>Starts when a repository is attached.</>
  if (phase === 2) return <>The import is running: {counts} mirrored so far.</>
  return <>{counts}, comments and checks</>
}

function FirstLookText({ phase }: { phase: Phase }) {
  if (phase < 3) return <>Waits for the import.</>
  return phase === 3 ? <>Every open issue checked. Nothing written to the forge.</> : <>Checked before switching on.</>
}

function SwitchText({ phase }: { phase: Phase }) {
  if (phase === 4) return <>Active. Briefs are prepared automatically. You approve what is built.</>
  return <>Briefs are prepared automatically. You approve what is built.</>
}

export function ConnectSteps({ product, look, phase }: Props) {
  const steps: { title: string; body: ReactNode }[] = [
    { title: 'Connect', body: <Connect product={product} phase={phase} /> },
    { title: 'Import', body: <Import look={look} phase={phase} /> },
    { title: 'First look', body: <FirstLookText phase={phase} /> },
    { title: 'Switch on', body: <SwitchText phase={phase} /> },
  ]
  return (
    <ol aria-label="Steps" className="m-0 grid list-none grid-cols-4 gap-3 p-0 max-lg:grid-cols-2 max-sm:grid-cols-1">
      {steps.map((step, index) => {
        const n = (index + 1) as Phase
        const state = stepState(n, phase)
        return (
          <li
            key={step.title}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex flex-col gap-1 rounded-md border bg-card p-3',
              state === 'current' ? 'border-primary bg-accent' : 'border-border',
            )}
          >
            <h3 className="label text-muted-foreground">
              {n} {step.title}
            </h3>
            <p className={cn('small', state === 'done' && CHECK_MARK)}>
              {state === 'done' && <span className="sr-only">Done: </span>}
              {step.body}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
