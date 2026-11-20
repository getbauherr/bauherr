import type { ReactNode } from 'react'
import type { FirstLook, RepositoryFacts } from '../../../../core/views/first-look'
import { copyForgeChecks } from '../../(shell)/settings/products/[id]/actions'
import { SettingsForm } from '../SettingsForm'
import { Card } from '../ui/card'

type Fact = { good: boolean; lead?: string; text: ReactNode }

const agents = <span className="mono">AGENTS.md</span>

const names = (list: string[]) => <span className="mono">{list.join(' · ')}</span>

const branchFact = (facts: RepositoryFacts): Fact => {
  const branch = facts.defaultBranch ?? 'The default branch'
  if (facts.branchProtected === 'yes') return { good: true, text: 'Default branch is protected' }
  if (facts.branchProtected === 'no') return { good: false, lead: 'Open', text: `${branch} is not protected.` }
  return { good: false, lead: 'Unknown', text: 'Bauherr cannot tell whether the default branch is protected.' }
}

const checksFact = (facts: RepositoryFacts): Fact =>
  facts.requiredChecksOnForge.length
    ? { good: true, text: <>Checks the forge requires: {names(facts.requiredChecksOnForge)}</> }
    : { good: false, lead: 'None', text: 'The forge requires no checks.' }

const agentsFact = (facts: RepositoryFacts): Fact =>
  facts.hasAgentsFile
    ? { good: true, text: <>{agents} is present</> }
    : { good: false, lead: 'Missing', text: <>{agents}. Agents work without the repository&apos;s own rules.</> }

const formsFact = (facts: RepositoryFacts): Fact =>
  facts.issueForms
    ? { good: true, text: `${facts.issueForms} issue ${facts.issueForms === 1 ? 'form' : 'forms'}` }
    : { good: false, lead: 'Missing', text: 'Issue forms. Required fields are then checked from the text.' }

const factsOf = (facts: RepositoryFacts): Fact[] => [
  checksFact(facts),
  branchFact(facts),
  agentsFact(facts),
  formsFact(facts),
]

const Good = () => (
  <>
    <span className="text-ok" aria-hidden="true">✓ </span>
    <span className="sr-only">Found: </span>
  </>
)

function Facts({ facts, many }: { facts: RepositoryFacts; many: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {many && <p className="mono small">{facts.repo}</p>}
      {facts.readAt === null ? (
        <p className="small text-muted-foreground">Not read yet. The first sync reads these.</p>
      ) : (
        factsOf(facts).map((fact, index) => (
          <p key={index} className="small">
            {fact.good ? <Good /> : <span className="text-warn">{fact.lead} </span>}
            {fact.text}
          </p>
        ))
      )}
    </div>
  )
}

type Props = { repository: FirstLook['repository']; product: number; admin: boolean }

export function RepositoryOffers({ repository, product, admin }: Props) {
  return (
    <Card asChild>
      <section aria-labelledby="offers">
        <h3 id="offers" className="label text-muted-foreground">What the repository offers</h3>
        {repository.repositories.length === 0 && <p className="small text-muted-foreground">No repository yet.</p>}
        {repository.repositories.map((facts) => (
          <Facts key={facts.repo} facts={facts} many={repository.repositories.length > 1} />
        ))}
        {admin && repository.suggestForgeChecks && (
          <SettingsForm action={copyForgeChecks} submit="Use these checks as required checks">
            <input type="hidden" name="id" value={product} />
          </SettingsForm>
        )}
      </section>
    </Card>
  )
}
