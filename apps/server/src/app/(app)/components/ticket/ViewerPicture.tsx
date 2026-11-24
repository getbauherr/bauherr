import type { TouchEvent } from 'react'
import { sourceOf, type ImageRef } from './image-ref'

const FIT = 'block max-h-full max-w-full object-contain'
const NATURAL = 'block max-w-none'
const FIT_BUTTON = 'flex h-full w-full items-center justify-center'
const NATURAL_BUTTON = 'm-auto flex'

type Props = {
  image: ImageRef
  natural: boolean
  onToggle: () => void
  onTouchStart: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
}

export function ViewerPicture({ image, natural, onToggle, onTouchStart, onTouchEnd }: Props) {
  return (
    <div className="flex overflow-auto bg-secondary" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button type="button" tabIndex={-1} className={natural ? NATURAL_BUTTON : FIT_BUTTON} onClick={onToggle}>
        <img src={sourceOf(image)} alt={image.caption} className={natural ? NATURAL : FIT} />
      </button>
    </div>
  )
}
