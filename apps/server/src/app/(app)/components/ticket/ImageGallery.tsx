'use client'
import { useRef, useState } from 'react'
import { sourceOf, type ImageRef } from './image-ref'
import { ImageViewer } from './ImageViewer'

const TRIGGER = 'block rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring'
const THUMB = 'block h-24 w-auto max-w-56 rounded-md object-cover'
const COLUMN_LIST = 'm-0 grid list-none gap-4 p-0 sm:grid-cols-3'
const COLUMN_THUMB = 'block h-auto w-full rounded-md'

type Props = { images: ImageRef[]; captions?: boolean; columns?: boolean }

export function ImageGallery({ images, captions = false, columns = false }: Props) {
  const [shown, setShown] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <ul className={columns ? COLUMN_LIST : 'm-0 flex list-none flex-wrap gap-4 p-0'}>
        {images.map((image, index) => (
          <li key={image.id} className={columns ? 'grid content-start gap-1' : 'grid max-w-56 gap-1'}>
            <button type="button" className={TRIGGER} onClick={(event) => {
                opener.current = event.currentTarget
                setShown(index)
              }}>
              <img src={sourceOf(image)} alt={image.caption} className={columns ? COLUMN_THUMB : THUMB} />
            </button>
            {captions && <span className="small text-muted-foreground">{image.caption}</span>}
          </li>
        ))}
      </ul>
      <ImageViewer images={images} shown={shown} onShow={setShown} opener={opener} />
    </>
  )
}
