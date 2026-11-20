'use client'
import { useContext, useId, type ChangeEventHandler, type ComponentProps, type ReactNode } from 'react'
import { FormStateContext } from './SettingsFormState'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NativeSelect } from './ui/native-select'
import { Textarea } from './ui/textarea'

export type Opt = string | [value: string, label: string]

type ControlProps = {
  name: string
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

function FieldControl({
  props,
  rest,
  options,
  empty,
  rows,
}: {
  props: ControlProps
  rest: Omit<ComponentProps<'input'>, 'name'>
  options?: Opt[]
  empty?: string
  rows?: number
}) {
  if (options)
    return (
      <NativeSelect
        {...props}
        defaultValue={rest.defaultValue}
        onChange={rest.onChange as ChangeEventHandler<HTMLSelectElement> | undefined}
        disabled={rest.disabled}
      >
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) =>
          Array.isArray(o) ? (
            <option key={o[0]} value={o[0]}>
              {o[1]}
            </option>
          ) : (
            <option key={o}>{o}</option>
          ),
        )}
      </NativeSelect>
    )
  if (rows)
    return (
      <Textarea
        {...props}
        rows={rows}
        defaultValue={rest.defaultValue}
        disabled={rest.disabled}
        required={rest.required}
        className="min-h-18"
      />
    )
  return <Input {...props} {...rest} />
}

export const describedBy = (uid: string, keys: (string | undefined | false | null)[]): string | undefined =>
  keys
    .filter(Boolean)
    .map((k) => `${uid}-${k}`)
    .join(' ') || undefined

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="small text-muted-foreground">
      {children}
    </span>
  )
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} role="alert" className="small text-destructive">
      {children}
    </span>
  )
}

export function Field({
  name,
  label,
  hint,
  example,
  explain,
  options,
  empty,
  rows,
  ...rest
}: {
  name: string
  label: string
  hint?: string
  example?: string
  explain?: string
  options?: Opt[]
  empty?: string
  rows?: number
} & Omit<ComponentProps<'input'>, 'name'>) {
  const error = useContext(FormStateContext).fields?.[name]
  const uid = useId()
  const described = describedBy(uid, [hint && 'h', example && 'x', error && 'e'])
  const props = { name, id: uid, 'aria-invalid': !!error || undefined, 'aria-describedby': described }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={uid} className="small">
        {label}
      </Label>
      {hint && <FieldHint id={`${uid}-h`}>{hint}</FieldHint>}
      <FieldControl props={props} rest={rest} options={options} empty={empty} rows={rows} />
      {example && (
        <span id={`${uid}-x`} className="small text-muted-foreground">
          e.g. <span className="mono">{example}</span>
        </span>
      )}
      {explain && (
        <details className="small text-muted-foreground">
          <summary className="cursor-pointer">What is this?</summary>
          {explain}
        </details>
      )}
      {error && <FieldError id={`${uid}-e`}>{error}</FieldError>}
    </div>
  )
}
