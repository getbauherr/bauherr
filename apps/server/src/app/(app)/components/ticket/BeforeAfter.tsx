'use client'
import { useState } from 'react'
import type { ScreenPair } from '../../../../core/views/ticket'
import { ImageGallery } from './ImageGallery'
import { sourceOf, type ImageRef } from './image-ref'
import { Section } from './Section'

const FRAME = 'block h-auto w-full max-w-3xl rounded-md border border-border'
const BUTTON = 'w-fit rounded-md border border-border px-3 py-1 text-sm'

const pictureOf = (label: string, pair: ScreenPair, id: number | undefined): ImageRef[] =>
  id === undefined ? [] : [{ id, caption: `${label}: ${pair.screen}, ${pair.width} px` }]

export const missingOf = (pair: ScreenPair): string | null => {
  if (pair.before && pair.after) return null
  if (!pair.before && !pair.after) return 'Missing: a before and an after picture.'
  return pair.before ? 'Missing: the after picture.' : 'Missing: the before picture.'
}

export function FlipFrame({ before, after }: { before: ImageRef; after: ImageRef }) {
  const [flipped, setFlipped] = useState(false)
  const shown = flipped ? after : before
  return (
    <div className="grid gap-2">
      <button type="button" className={BUTTON} aria-pressed={flipped} onClick={() => setFlipped(!flipped)}>
        Flip before / after
      </button>
      <img src={sourceOf(shown)} alt={shown.caption} className={FRAME} />
    </div>
  )
}

function PairBlock({ pair }: { pair: ScreenPair }) {
  const before = pictureOf('Before', pair, pair.before?.id)[0]
  const after = pictureOf('After', pair, pair.after?.id)[0]
  const plan = { id: pair.mockup.id, caption: `Plan: ${pair.screen}` }
  const missing = missingOf(pair)
  return (
    <div className="grid gap-2">
      <h3 className="m-0 font-semibold">
        {pair.screen}
        {pair.width !== null && ` · ${pair.width} px`}
      </h3>
      <ImageGallery images={[...(before ? [before] : []), ...(after ? [after] : []), plan]} captions />
      {missing && <p className="small m-0 text-muted-foreground">{missing}</p>}
      {before && after && <FlipFrame before={before} after={after} />}
    </div>
  )
}

export function BeforeAfter({ pairs }: { pairs: ScreenPair[] }) {
  if (pairs.length === 0) return null
  return (
    <Section title="Before and after">
      {pairs.map((pair) => (
        <PairBlock key={`${pair.screen}-${pair.width}`} pair={pair} />
      ))}
    </Section>
  )
}
