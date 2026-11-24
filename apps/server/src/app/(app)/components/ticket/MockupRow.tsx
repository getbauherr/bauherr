import type { AttachmentView } from '../../../../core/views/attachments'
import { ImageGallery } from './ImageGallery'
import { MockupFrame } from './MockupFrame'
import { Section } from './Section'

const NONE = 'No mockup: the Runner cannot make one. Request changes or send it to a session if you need a picture.'

export function MockupRow({ mockups, missing }: { mockups: AttachmentView[]; missing: boolean }) {
  if (mockups.length === 0) return missing ? <p className="small text-muted-foreground">{NONE}</p> : null
  const live = mockups.filter((mockup) => mockup.html)
  const pictures = mockups.filter((mockup) => !mockup.html)
  return (
    <Section title="Mockups">
      {live.map((mockup) => (
        <MockupFrame key={mockup.id} mockup={mockup} />
      ))}
      <ImageGallery images={pictures} captions />
    </Section>
  )
}
