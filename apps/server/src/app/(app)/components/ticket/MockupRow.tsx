import type { AttachmentView } from '../../../../core/views/attachments'
import { ImageThumb } from './ImageThumb'
import { Section } from './Section'

const NONE = 'No mockup: the Runner cannot make one. Request changes or send it to a session if you need a picture.'

export function MockupRow({ mockups, missing }: { mockups: AttachmentView[]; missing: boolean }) {
  if (mockups.length === 0) return missing ? <p className="small text-muted-foreground">{NONE}</p> : null
  return (
    <Section title="Mockups">
      <ul className="m-0 flex list-none flex-wrap gap-4 p-0">
        {mockups.map((mockup) => (
          <li key={mockup.id} className="grid max-w-56 gap-1">
            <ImageThumb image={mockup} />
            <span className="small text-muted-foreground">{mockup.caption}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
