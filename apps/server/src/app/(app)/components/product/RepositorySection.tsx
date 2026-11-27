import Link from 'next/link'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { addRepository } from '../../(shell)/settings/actions'
import { saveExecutor } from '../../(shell)/settings/products/[id]/actions'
import { EmptyState } from '../EmptyState'
import { RepositoryFields } from '../ProductForms'
import { SettingsForm } from '../SettingsForm'
import { RadioCards, SettingsSection } from '../SettingsParts'
import { Editable } from './Editable'
import { MirrorState } from './MirrorState'
import { ProductStateForm } from './ProductStateForm'
import { RemoveDoc } from './RemoveDoc'
import { Input } from '../ui/input'

const EXECUTORS = [
  { value: 'session', title: 'An agent session', text: 'Your own agent connects over MCP and takes the queued runs.' },
  { value: 'runner', title: 'The Runner', text: 'Bauherr starts the agents itself and needs no session.' },
]

const LINK = 'small text-primary underline underline-offset-2'

type Connections = { id: number; name: string }[]
type Props = { product: ProductSettings; connections: Connections; admin: boolean }

function Repositories({ product }: { product: ProductSettings }) {
  if (!product.repositories.length) return <p className="small text-muted-foreground">No repository yet.</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {product.repositories.map((r) => {
        const source = product.sources.find((s) => s.repo === r.fullName)
        return (
          <li key={r.id} className="flex flex-col gap-1">
            <span className="mono">{r.fullName}</span>
            <span className="small text-muted-foreground">
              {source ? <MirrorState source={source} /> : 'Tickets are not read from this repository.'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Removals({ product }: { product: ProductSettings }) {
  return (
    <>
      <p className="small text-muted-foreground">
        Short name <span className="mono">{product.slug}</span>. It cannot change.
      </p>
      {product.sources.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono small">{s.repo}</span>
          <RemoveDoc collection="ticket_sources" id={s.id} label="Stop reading tickets" />
        </div>
      ))}
      {product.repositories.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono small">{r.fullName}</span>
          <RemoveDoc collection="repositories" id={r.id} label="Remove repository" />
        </div>
      ))}
    </>
  )
}

function AddRepository({ product, connections }: { product: ProductSettings; connections: Connections }) {
  if (!connections.length) {
    const action = { href: '/settings/connections', label: 'Add connection' }
    return <EmptyState text="Bauherr needs access to GitHub or GitLab first." action={action} />
  }
  return (
    <details open={product.repositories.length === 0}>
      <summary className="small cursor-pointer text-primary">Add a repository</summary>
      <div className="mt-3">
        <SettingsForm action={addRepository} submit="Add repository" reset>
          <Input type="hidden" name="id" value={product.id} />
          <RepositoryFields connections={connections} />
        </SettingsForm>
      </div>
    </details>
  )
}

function State({ product, admin }: { product: ProductSettings; admin: boolean }) {
  const observing = product.state === 'observing'
  return (
    <div id="state" className="flex flex-col items-start gap-2 border-t border-border pt-4">
      <p className="small">{observing ? 'Observing: nothing is written to the forge' : 'Active'}</p>
      <div className="flex flex-wrap items-center gap-3">
        {observing && product.sources.length > 0 && (
          <Link href={`/settings/products/${product.id}/connect`} className={LINK}>
            See the first look
          </Link>
        )}
        {admin && <ProductStateForm product={product.id} state={product.state} />}
      </div>
    </div>
  )
}

export function RepositorySection({ product, connections, admin }: Props) {
  const names = [...new Set(product.sources.flatMap((s) => (s.connection ? [s.connection] : [])))]
  return (
    <SettingsSection
      id="repository"
      title="Repository"
      purpose="The code the agents work in and where new tickets come from."
      advanced={admin ? <Removals product={product} /> : undefined}
    >
      <p className="small">
        <span className="text-muted-foreground">Connection </span>
        {names.join(', ') || 'None yet'}
      </p>
      <Repositories product={product} />
      <Editable admin={admin}>
        <SettingsForm action={saveExecutor} submit="Save">
          <Input type="hidden" name="id" value={product.id} />
          <RadioCards name="executor" legend="Who works the runs?" value={product.executor} options={EXECUTORS} />
        </SettingsForm>
      </Editable>
      {product.executor === 'session' && (
        <p className="small text-muted-foreground">
          A session needs an agent key and one command.{' '}
          <Link href="/settings/api-key" className={LINK}>
            Connect a session
          </Link>
        </p>
      )}
      <State product={product} admin={admin} />
      {admin && <AddRepository product={product} connections={connections} />}
    </SettingsSection>
  )
}
