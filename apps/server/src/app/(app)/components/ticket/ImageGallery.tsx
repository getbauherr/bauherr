'use client'
import { useRef, useState } from 'react'
import { sourceOf, type ImageRef } from './image-ref'
import { ImageViewer } from './ImageViewer'
import { Button } from '../ui/button'

const TRIGGER = 'block h-auto rounded-md border border-border p-0 hover:bg-transparent'
const THUMB = 'block h-24 w-auto max-w-56 rounded-md object-cover'
const LAYOUTS = {
  row: { list: 'm-0 flex list-none flex-wrap gap-4 p-0', item: 'grid max-w-56 gap-1', thumb: THUMB },
  columns: {
    list: 'm-0 grid list-none gap-4 p-0 sm:grid-cols-3',
    item: 'grid content-start gap-1',
    thumb: 'block h-auto w-full rounded-md',
  },
  large: {
    list: 'm-0 flex list-none flex-wrap gap-4 p-0',
    item: 'grid min-w-0 gap-1',
    thumb: 'block h-auto w-full max-w-3xl rounded-md',
  },
} as const


type Props = { images: ImageRef[]; captions?: boolean; columns?: boolean; large?: boolean }

export function ImageGallery({ images, captions = false, columns = false, large = false }: Props) {
  const [shown, setShown] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  if (images.length === 0) return null
  const layout = LAYOUTS[columns ? 'columns' : large ? 'large' : 'row']
  return (
    <>
      <ul className={layout.list}>
        {images.map((image, index) => (
          <li key={image.id} className={layout.item}>
            <Button type="button" variant="ghost" className={TRIGGER} onClick={(event) => {
                opener.current = event.currentTarget
                setShown(index)
              }}>
              <img src={sourceOf(image)} alt={image.caption} className={layout.thumb} />
            </Button>
            {captions && <span className="small text-muted-foreground">{image.caption}</span>}
          </li>
        ))}
      </ul>
      <ImageViewer images={images} shown={shown} onShow={setShown} opener={opener} />
    </>
  )
}
