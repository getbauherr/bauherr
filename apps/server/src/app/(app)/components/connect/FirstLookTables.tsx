import type { FirstLook } from '../../../../core/views/first-look'
import { formatCount } from '../product/MirrorState'

type Row = { label: string; value: number; note: string }

const issueRows = (issues: FirstLook['issues']): Row[] => [
  { label: 'Ready for a Brief', value: issues.readyForBrief, note: 'Complete, no duplicate, trusted author' },
  {
    label: 'Needs information',
    value: issues.needingInformation,
    note: 'Questions are drafted and sent when you switch on.',
  },
  { label: 'Duplicates', value: issues.closedAsDuplicate, note: 'Each with the issue it repeats' },
  {
    label: 'No activity for a year',
    value: issues.withoutActivityForAYear,
    note: 'Briefed last; reorder on the board',
  },
  { label: 'Outside authors', value: issues.heldForOutsideAuthor, note: 'Held until labelled' },
  { label: 'Assigned to a person', value: issues.assignedToPerson, note: 'Not touched' },
]

const pullRows = (pulls: FirstLook['pullRequests']): Row[] => [
  {
    label: 'Linked to an issue',
    value: pulls.closingAnIssue,
    note: 'Ready pull requests of your team. They enter at Verify: proof and review, you accept',
  },
  {
    label: 'Other pull requests',
    value: pulls.notClosingAnIssue,
    note: 'Drafts, outside authors or no single open issue. Listed, not touched',
  },
]

function Group({ title, total, rows }: { title: string; total: number; rows: Row[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="label text-muted-foreground">
        {title}, <span className="mono">{formatCount(total)}</span>
      </h3>
      <table className="w-full border-collapse overflow-hidden rounded-md border border-border">
        <caption className="sr-only">{title}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-b-0 max-sm:flex max-sm:flex-wrap">
              <th scope="row" className="p-3 text-left font-normal max-sm:flex-1">{row.label}</th>
              <td className="mono p-3 text-right">{formatCount(row.value)}</td>
              <td className="small p-3 text-muted-foreground max-sm:w-full max-sm:pt-0">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export function FirstLookTables({ look }: { look: FirstLook }) {
  return (
    <div className="flex flex-col gap-6">
      <Group title="Open issues" total={look.issues.open} rows={issueRows(look.issues)} />
      <Group title="Open pull requests" total={look.pullRequests.open} rows={pullRows(look.pullRequests)} />
    </div>
  )
}
