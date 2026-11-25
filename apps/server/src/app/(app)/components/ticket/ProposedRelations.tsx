import type { ProposedRelation } from '../../../../core/record/schema'
import { RefText } from '../RefText'
import { RelationRow } from './RelationRow'
import { Section } from './Section'

const WORDS = { 'blocked-by': 'Blocked by', 'part-of': 'Part of' } as const

type Props = { relations: ProposedRelation[]; repo: string; removable: boolean }

export function ProposedRelations({ relations, repo, removable }: Props) {
  if (relations.length === 0) return null
  return (
    <Section title={removable ? 'Proposed relations' : 'Relations'}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {relations.map((relation, index) => (
          <RelationRow
            key={`${relation.type}-${relation.ticket}`}
            index={index}
            name={`${WORDS[relation.type]} #${relation.ticket}`}
            removable={removable}
          >
            {WORDS[relation.type]} <RefText text={`#${relation.ticket}`} repo={repo} />
            <span className="text-muted-foreground"> ({relation.reason})</span>
          </RelationRow>
        ))}
      </ul>
    </Section>
  )
}
