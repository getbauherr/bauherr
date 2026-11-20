import type { ProofGroup, ProofView } from '../../../../core/views/ticket-parts'
import { PROOF_WORDS } from '../../lib/ticket'
import { ForgeLink } from './ForgeLink'
import { Section } from './Section'

const BLOCK = 'mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3'

function Proof({ proof }: { proof: ProofView }) {
  const word = PROOF_WORDS[proof.kind] ?? proof.kind
  return (
    <li className="grid gap-1">
      <span className="small text-muted-foreground">{word}</span>
      {proof.body !== null && <pre className={BLOCK}>{proof.body}</pre>}
      {proof.url !== null && <ForgeLink href={proof.url} label={proof.url} />}
    </li>
  )
}

export function ProofPanel({ group, number }: { group: ProofGroup | undefined; number: number }) {
  if (!group) return null
  return (
    <Section title={`Proof for criterion ${number}`}>
      <ul className="m-0 grid list-none gap-3 p-0">
        {group.proofs.map((proof) => (
          <Proof key={proof.id} proof={proof} />
        ))}
      </ul>
    </Section>
  )
}
