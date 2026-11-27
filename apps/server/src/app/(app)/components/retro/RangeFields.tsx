import { NativeSelect } from '../ui/native-select'
import { Input } from '../ui/input'
import { Radio } from '../ui/radio'

type Props = { range: string; tag: string | undefined; tags: string[]; from: string; to: string; lastLabel: string }

export function RangeFields({ range, tag, tags, from, to, lastLabel }: Props) {
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mb-2 font-semibold">Range</legend>
      <label className="flex items-center gap-2">
        <Radio name="range" value="last" defaultChecked={range === 'last'} />
        {lastLabel}
      </label>
      <label className="flex flex-wrap items-center gap-2">
        <Radio name="range" value="tag" defaultChecked={range === 'tag'} />
        Since a release
        <NativeSelect name="tag" aria-label="Release" defaultValue={tag}>
          {tags.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        <Radio name="range" value="dates" defaultChecked={range === 'dates'} />
        Between two dates
        <Input type="date" name="from" aria-label="From" defaultValue={from} />
        <Input type="date" name="to" aria-label="To" defaultValue={to} />
      </label>
    </fieldset>
  )
}
