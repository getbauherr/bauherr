import { forgeText, nothingVisible } from '../../../../core/releases/forge-text'
import type { NoteItem } from '../../../../core/releases/notes'
import type { ReleasesView } from '../../../../core/releases/view'
import { publicUrl } from '../../../../lib/oidc'
import { addNoteAction, writeNotesAction } from '../../(shell)/releases/actions'
import { shortDate } from '../../lib/format'
import { Sparkles, Wrench } from '../icons'
import { Button } from '../ui/button'
import { NoteForm } from './NoteForm'
import { NoteRow } from './NoteRow'
import { Input } from '../ui/input'

const SECTIONS = [
  { kind: 'new', heading: 'New and improved', Icon: Sparkles },
  { kind: 'fixed', heading: 'Fixed', Icon: Wrench },
] as const

const PRE =
  'mono small mt-2 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary p-3'

const NEW_ITEM = { id: null, kind: 'new', area: 'Factory', title: '', text: '' } as const

type SectionProps = { section: (typeof SECTIONS)[number]; items: NoteItem[]; product: number }

function Section({ section, items, product }: SectionProps) {
  const mine = items.filter((entry) => entry.kind === section.kind)
  if (mine.length === 0) return null
  return (
    <div>
      <h3 className="label mb-2 flex items-center gap-1.5 text-muted-foreground">
        <section.Icon className="size-3.5 text-primary" />
        {section.heading}
      </h3>
      <ul className="m-0 list-none p-0">
        {mine.map((entry) => <NoteRow key={entry.id} item={entry} product={product} />)}
      </ul>
    </div>
  )
}

function Notes({ notes, product }: { notes: NonNullable<ReleasesView['notes']>; product: number }) {
  const items = notes.items.filter((entry) => !entry.removed)
  const link = `${publicUrl()}/releases?product=${product}#notes`
  return (
    <div className="grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <header>
        <b className="block text-[17px] leading-6">{shortDate(notes.generatedAt)}</b>
        <span className="small text-muted-foreground">Next version</span>
      </header>
      <div className="grid gap-5">
        {items.length === 0 && <p className="small m-0 text-muted-foreground">{nothingVisible(notes.internal)}</p>}
        {SECTIONS.map((section) => <Section key={section.kind} section={section} items={items} product={product} />)}
        <details>
          <summary className="small cursor-pointer text-primary">+ Add an item</summary>
          <div className="mt-2 max-w-sm">
            <NoteForm action={addNoteAction} product={product} draft={NEW_ITEM} submit="Add" />
          </div>
        </details>
        <details>
          <summary className="small cursor-pointer text-primary">Text for the forge</summary>
          <pre className={PRE}>
            {forgeText(items, notes.internal, link)}
          </pre>
        </details>
        <p className="small m-0 text-muted-foreground">
          The pencil edits an item. Your edits, added items and removed items are kept when the notes are written
          again.
        </p>
      </div>
    </div>
  )
}

export function ReleaseNotes({ view }: { view: ReleasesView }) {
  const { notes, product } = view
  if (product === null) return null
  return (
    <section aria-labelledby="notes" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="notes" className="heading">Release notes</h2>
        {notes && <span className="small text-muted-foreground">{notes.internal} internal changes not listed</span>}
        <form action={writeNotesAction} className="ml-auto">
          <Input type="hidden" name="product" value={product.id} />
          <Button type="submit" variant="outline" size="sm">{notes ? 'Write again' : 'Write the notes'}</Button>
        </form>
      </div>
      {notes === null && (
        <p className="small m-0 text-muted-foreground">
          The notes for the next version are not written yet. They are written for people who use the product.
        </p>
      )}
      {notes && <Notes notes={notes} product={product.id} />}
    </section>
  )
}
