import type { AttachmentView } from '../../../../core/views/attachments'
import { ImageGallery } from './ImageGallery'
import { Section } from './Section'

const NONE = 'No mockup: the Runner cannot make one. Request changes or send it to a session if you need a picture.'

export function MockupRow({ mockups, missing }: { mockups: AttachmentView[]; missing: boolean }) {
  if (mockups.length === 0) return missing ? <p className="small text-muted-foreground">{NONE}</p> : null
  return (
    <Section title="Mockups">
      <ImageGallery images={mockups} captions />
    </Section>
  )
}
