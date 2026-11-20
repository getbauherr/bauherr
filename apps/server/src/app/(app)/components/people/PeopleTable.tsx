import { assignmentWords } from '../../../../lib/people'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'
import { LABEL } from './labels'
import { PersonActions } from './PersonActions'
import type { Assignable, Person, WorkspaceItem } from './types'

function AccessCell({ b }: { b: Person }) {
  return (
    <td>
      {b.role === 'product-owner'
        ? assignmentWords(
            b.assignments.map((a) => ({
              workspace: a.workspace.name,
              scope: a.scope,
              products: a.products.map((p) => p.name),
            })),
          )
        : b.workspaces.map((w) => w.name).join(', ')}
    </td>
  )
}

function ForgeLoginCell({ b }: { b: Person }) {
  return (
    <td>
      {b.githubLogin ? (
        `@${b.githubLogin}`
      ) : (
        <span
          className="text-warn"
          title={'A label or comment from this person on the forge does not count until they link ' + 'their login'}
        >
          not linked
        </span>
      )}
    </td>
  )
}

function PersonRow({
  b,
  admin,
  userId,
  assignable,
  items,
}: {
  b: Person
  admin: boolean
  userId: number | string
  assignable: Assignable
  items: WorkspaceItem[]
}) {
  return (
    <tr>
      <td>
        {b.email}
        {b.locked && (
          <>
            {' '}
            <Badge variant="destructive">Locked</Badge>
          </>
        )}
      </td>
      <td>{LABEL[b.role] ?? b.role}</td>
      <AccessCell b={b} />
      <ForgeLoginCell b={b} />
      <td>{b.oidcLinked ? 'linked' : <span className="text-muted-foreground">—</span>}</td>
      {admin && (
        <td>
          <PersonActions b={b} userId={userId} assignable={assignable} items={items} />
        </td>
      )}
    </tr>
  )
}

export function PeopleTable({
  people,
  admin,
  userId,
  assignable,
  items,
}: {
  people: Person[]
  admin: boolean
  userId: number | string
  assignable: Assignable
  items: WorkspaceItem[]
}) {
  return (
    <Table>
      <thead>
        <tr className="label">
          <th>Email</th>
          <th>Role</th>
          <th>Access</th>
          <th>Forge login</th>
          <th>SSO</th>
          {admin && (
            <th>
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {people.map((b) => (
          <PersonRow key={b.id} b={b} admin={admin} userId={userId} assignable={assignable} items={items} />
        ))}
      </tbody>
    </Table>
  )
}
