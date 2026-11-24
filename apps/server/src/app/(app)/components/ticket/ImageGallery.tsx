'use client'
import { useRef, useState } from 'react'
import { sourceOf, type ImageRef } from './image-ref'
import { ImageViewer } from './ImageViewer'

const TRIGGER = 'block rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring'
const THUMB = 'block h-24 w-auto max-w-56 rounded-md object-cover'

export function ImageGallery({ images, captions = false }: { images: ImageRef[]; captions?: boolean }) {
  const [shown, setShown] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap gap-4 p-0">
        {images.map((image, index) => (
          <li key={image.id} className="grid max-w-56 gap-1">
            <button type="button" className={TRIGGER} onClick={(event) => {
                opener.current = event.currentTarget
                setShown(index)
              }}>
              <img src={sourceOf(image)} alt={image.caption} className={THUMB} />
            </button>
            {captions && <span className="small text-muted-foreground">{image.caption}</span>}
          </li>
        ))}
      </ul>
      <ImageViewer images={images} shown={shown} onShow={setShown} opener={opener} />
    </>
  )
}
