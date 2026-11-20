import { Field } from './SettingsForm'
import { ToggleRow } from './SettingsParts'

export const RepositoryFields = ({
  connections,
  tickets = true,
}: {
  connections: { id: number; name: string }[]
  tickets?: boolean
}) => (
  <>
    <Field
      name="fullName"
      label="Repository"
      hint="The code repository the agents work in."
      example="acme/shop"
      required
    />
    <Field
      name="connection"
      label="Account"
      hint="The GitHub or GitLab account Bauherr uses to read and write this repository."
      options={connections.map((c) => [String(c.id), c.name])}
    />
    {tickets && (
      <ToggleRow
        name="readTickets"
        label="Read tickets from this repository"
        help="Bauherr picks up new issues from this repository as Tickets."
        defaultChecked
      />
    )}
  </>
)
