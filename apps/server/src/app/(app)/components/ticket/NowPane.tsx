import type { TicketView } from '../../../../core/views/ticket'
import { BriefCard } from './BriefCard'
import { IntakeView } from './IntakeView'
import { QuestionCard } from './QuestionCard'
import { ResultCard } from './ResultCard'
import { StatusBlock } from './StatusBlock'

export function NowPane({ view, proof, may }: { view: TicketView; proof: string | undefined; may: boolean }) {
  const { card } = view
  if (card?.card === 'brief') return <BriefCard view={view} seq={card.seq} reason={card.reason} may={may} />
  if (card?.card === 'result') return <ResultCard view={view} seq={card.seq} proof={proof} may={may} />
  if (card) return <QuestionCard view={view} card={card} may={may} />
  return view.stage === 'intake' ? <IntakeView view={view} /> : <StatusBlock view={view} />
}
