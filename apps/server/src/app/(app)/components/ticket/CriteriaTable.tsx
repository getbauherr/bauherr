import Link from 'next/link'
import type { Criterion } from '../../../../core/record/schema'
import type { ProofGroup } from '../../../../core/views/ticket-parts'
import { CRITERION_WORDS, PROOF_WORDS, ticketHref, VERIFY_WORDS, type Tab } from '../../lib/ticket'
import { WordBadge } from '../WordBadge'
import { ImageGallery } from './ImageGallery'
import { RefText } from '../RefText'

const TABLE = 'w-full border-collapse overflow-hidden rounded-md border border-border'
const TH = 'label border-b border-border bg-secondary px-3 py-2 text-left font-medium text-muted-foreground'
const TD = 'border-b border-border px-3 py-2 align-top last:border-b-0'

export type ProofLinking = { recordId: number; tab: Tab; proofs: ProofGroup[]; selected: string | null }

type Props = { criteria: Criterion[]; repo: string } & ({ mode: 'brief' } | ({ mode: 'result' } & ProofLinking))

function ProofLinks({ criterion, ...linking }: { criterion: Criterion } & ProofLinking) {
  const { proofs, recordId, tab, selected } = linking
  const given = proofs.find((group) => group.criterion === criterion.id)?.proofs ?? []
  if (given.length === 0) return <span className="text-muted-foreground">None</span>
  const words = [...new Set(given.map((proof) => proof.kind))].map((kind) => PROOF_WORDS[kind] ?? kind).join(', ')
  const images = given.flatMap((proof) => (proof.attachment === null ? [] : [proof.attachment]))
  return (
    <div className="grid justify-items-start gap-2">
    <Link
      href={ticketHref(recordId, tab, criterion.id)}
      aria-current={selected === criterion.id ? 'true' : undefined}
      className="text-primary hover:underline"
    >
      {words}
      <span className="sr-only"> for criterion {criterion.id.slice(1)}</span>
    </Link>
    <ImageGallery images={images} />
    </div>
  )
}

export function CriteriaTable(props: Props) {
  const result = props.mode === 'result' ? props : null
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <caption className="sr-only">Acceptance criteria</caption>
        <thead>
          <tr>
            <th scope="col" className={`${TH} w-8`}><span className="sr-only">Number</span></th>
            <th scope="col" className={TH}>Criterion</th>
            {result ? <th scope="col" className={TH}>Status</th> : null}
            <th scope="col" className={TH}>{result ? 'Proof' : 'Verified by'}</th>
          </tr>
        </thead>
        <tbody>
          {props.criteria.map((criterion, index) => (
            <tr key={criterion.id}>
              <td className={`${TD} mono text-muted-foreground`}>{index + 1}</td>
              <td className={TD}><RefText text={criterion.text} repo={props.repo} /></td>
              {result ? <td className={TD}><WordBadge word={CRITERION_WORDS[criterion.status]} /></td> : null}
              <td className={TD}>
                {result ? <ProofLinks criterion={criterion} {...result} /> : VERIFY_WORDS[criterion.verify.kind]}
                {!result && <span className="small block text-muted-foreground">
                    <RefText text={criterion.verify.how} repo={props.repo} />
                  </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
