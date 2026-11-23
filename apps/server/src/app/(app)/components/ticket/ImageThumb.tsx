import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../ui/dialog'

export type ImageRef = { id: number; caption: string }

const TRIGGER = 'block rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring'
const FULL = 'max-h-[90vh] overflow-auto sm:max-w-[min(1360px,calc(100%-2rem))]'

const sourceOf = (image: ImageRef): string => `/api/attachments/${image.id}`

export function ImageThumb({ image }: { image: ImageRef }) {
  return (
    <Dialog>
      <DialogTrigger className={TRIGGER}>
        <img src={sourceOf(image)} alt={image.caption} className="block h-24 w-auto max-w-56 rounded-md object-cover" />
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className={FULL}>
        <DialogTitle>{image.caption}</DialogTitle>
        <img src={sourceOf(image)} alt={image.caption} className="block h-auto w-full" />
      </DialogContent>
    </Dialog>
  )
}
