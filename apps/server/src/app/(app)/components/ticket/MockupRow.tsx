import type { AttachmentView } from '../../../../core/views/attachments'
import { ImageThumb } from './ImageThumb'
import { Section } from './Section'

export function MockupRow({ mockups }: { mockups: AttachmentView[] }) {
  if (mockups.length === 0) return null
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
