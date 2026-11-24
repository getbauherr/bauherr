import { Button } from '../ui/button'
import { DialogClose } from '../ui/dialog'
import { sourceOf, type ImageRef } from './image-ref'

type Props = {
  image: ImageRef
  position: string
  many: boolean
  natural: boolean
  onStep: (by: number) => void
  onToggle: () => void
}

export function ViewerBar({ image, position, many, natural, onStep, onToggle }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
      <span aria-live="polite" className="font-mono">
        {position}
      </span>
      <div className="flex flex-wrap gap-2">
        {many && (
          <Button variant="outline" onClick={() => onStep(-1)}>
            Previous
          </Button>
        )}
        {many && (
          <Button variant="outline" onClick={() => onStep(1)}>
            Next
          </Button>
        )}
        <Button variant="outline" aria-pressed={natural} onClick={onToggle}>
          {natural ? 'Actual size' : 'Fit to screen'}
        </Button>
        <Button variant="outline" asChild>
          <a href={sourceOf(image)} target="_blank" rel="noopener">
            Open in new tab
          </a>
        </Button>
        <DialogClose asChild>
          <Button variant="outline">Close</Button>
        </DialogClose>
      </div>
    </div>
  )
}
