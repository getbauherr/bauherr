import type { StartData } from '../../lib/retro-start'
import { shortDate } from '../../lib/format'
import { startRetroAction } from '../../(shell)/memory/retro/actions'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'
import { RangeFields } from './RangeFields'

type Props = { data: StartData; params: Record<string, string | undefined> }

const span = (range: NonNullable<StartData['range']>): string =>
  `${shortDate(range.from.toISOString())} to ${shortDate(range.to.toISOString())}`

export function StartForm({ data, params }: Props) {
  const { product, products, last, tags, since, range, preview } = data
  return (
    <form method="get" className="grid max-w-xl gap-5">
      <label className="flex items-center gap-2">
        Product
        <NativeSelect name="product" defaultValue={String(product.id)}>
          {products.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <RangeFields
        range={params.range ?? 'last'}
        tag={params.tag ?? tags[0]}
        tags={tags}
        from={params.from ?? ''}
        to={params.to ?? ''}
        lastLabel={last ? `Since the last Retro (${shortDate(last.to.toISOString())})` : 'Last 30 days'}
      />
      {since && <input type="hidden" name="since" value={since} />}
      <Button type="submit" variant="outline" className="w-fit">
        Show what this range holds
      </Button>
      <section aria-label="What this range holds" className="grid gap-1">
        <h2 className="m-0 text-base font-semibold">What this range holds</h2>
        {preview && range ? (
          <p className="m-0">
            {span(range)}: {preview.accepted} tickets accepted, {preview.runs} runs, {preview.questions} questions to
            you.
          </p>
        ) : (
          <p className="m-0 text-muted-foreground">Pick a range that starts before it ends.</p>
        )}
      </section>
      {params.error && (
        <p role="alert" className="m-0 text-destructive">
          {params.error}
        </p>
      )}
      <Button type="submit" formAction={startRetroAction} formMethod="post" disabled={!range} className="w-fit">
        Start Retro
      </Button>
    </form>
  )
}
