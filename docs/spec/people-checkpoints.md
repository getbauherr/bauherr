# Addressed checkpoints

Every human checkpoint asks one of two people: the Bauherr or the Product owner. A Bauherr or Admin can always decide what asks the Product owner, recorded as `bauherr`. The reverse never holds.

## Factory file keys

- `gate: human` means `{by: bauherr}`.
- `gate: {by: bauherr | product-owner}` is allowed on `plan` and `release`. `production_gate` takes the same, `refine: {by: ...}` goes on the `triage` stage for Triage's questions, and `by:` goes on a `human` stage.
- A file or stored version without `by:` asks the Bauherr everywhere.
- `lint` refuses anything else: `gate` with other keys, `refine` off the triage stage, `by` off a human stage.
- Compiled, only `product-owner` is stored: `gate_by`, `production_gate_by`, `refine_by`, `by`. A file that does not use it compiles as before and applies as no new version.

## Defaults

The shipped default is `pack/factory.yaml`, the Standard preset.

| Checkpoint | Standard | Careful | Solo |
|---|---|---|---|
| Refinement | Product owner | Product owner | Bauherr |
| Plan approval | Bauherr | Bauherr | Bauherr |
| Production | Bauherr | Bauherr | Bauherr |
| Staging acceptance | Product owner per Product | Bauherr | Bauherr |

- A Workspace with an applied version keeps its checkpoints until it applies a new one. One without an applied version runs the shipped default, which asks the Product owner only where a Product has one assigned.

## No Product owner assigned

A checkpoint addressed to the Product owner of a Product without one asks the Bauherr, `askedOf` in `lib/addressee.ts`.

Staging acceptance does not fall back. With `gate: {by: product-owner}` on `release`, it is on only for a Product with an assigned Product owner and the Product switch "Product owner tests on staging", `products.productOwnerTestsStaging` under Product > Approvals. `stagingGateOn` in `lib/mode.ts` decides. Otherwise the Product has no acceptance checkpoint and passes staging by itself, as without a gate.

`gate: human` is on for every Product, whatever the switch says.

## Who may decide

`mayDecide(user, {ticket, addressee})` in `lib/people.ts`:

| User | May decide |
|---|---|
| Bauherr or Admin of the Ticket's Workspace | Always |
| Product owner | Only when the checkpoint or decision row is addressed to the Product owner and the Ticket's Product is in their assignment |
| Anyone else | Never |

- Every gate function in `lib/actions.ts` starts with `loadGate`. They are `approvePlan`, `acceptStaging`, `requestChanges`, `decide`, `approveProduction`, `postDecisions` and `finishRefinement`.
- UI actions, the MCP human tools and chat tools call these same functions, so there is one rule. The human tools are `approve`, `accept_staging`, `decide`, `approve_production` and `request_changes`.
- A Ticket outside the assignment answers `NotInWorkspace`, 404. One they see that is not addressed to them answers `NotAddressed`, "this decision is not addressed to you".
- An agent key is refused on every human tool, `access: 'human'`. A Product owner has no MCP at all.

## Who is asked, stored

- `tickets.needsBy`, `bauherr` or `product-owner`, is written by the gate sweep with `needsYou`. `needBy` from the file comes first, then `askedOf`. It is null while nothing is asked. The migration backfills `bauherr` for every open need.
- The Inbox, sidebar badge and forge notice follow it. A Product owner's Inbox and badge count only Tickets with `needsBy = product-owner` on their Products. A Bauherr's Inbox lists every card and marks those asking the Product owner, "Asked: Product owner", `data-testid="asked"`.
- The forge notice goes to the `githubLogin` of the assigned Product owners when it asks them, else to the Product's gate owners.
- Rows with `for: product-owner` on a checkpoint that asks the Bauherr are counted when the sheet is written or answered, `tickets.openOwnerRows` and `storeOpenCritical`. With the need Answer questions or Answer decisions they also put the Ticket in a Product owner's Inbox and badge, `asksOwner`. No forge call happens at render.
- The typed turn route uses the same rule, `hasRows`: rows addressed to the person.
- The human touch, `human_touches`, records `actor`, `as` and `addressee`. A Bauherr who accepts a Product owner's staging is `actor: <email>, as: bauherr, addressee: product-owner`.

## Decision rows

A row of a plan or Triage sheet may carry `for: product-owner | bauherr`, as `critical: true. for: bauherr.` or a sixth table column. Without it the row asks whom the checkpoint asks.

- A sheet can be mixed. The Product owner's refinement conversation, `RefineConversation`, is reached from their Inbox card or `/tickets/<id>?view=conversation`. It lists only their rows, `Point.for`, and the model sees only those.
- `/api/refine/[ticket]/turn` and the actions `refineState`, `refineSay`, `refinePick`, `refineExplain`, `refineRest`, `refineChange` and `refineFinish` are open to them.
- `postDecisions` refuses an answer, a reopen or a new row for someone else's.
- A Bauherr sees and answers all rows. "Send to planning" stays refused while any critical row is open, whoever it is for.
- A Product owner sees no model choice and no cost. `View.viewer` empties `models` and `cost` and strips usage and the session's model. `refineTier` stays the Bauherr's.
- `decideAction`, an Inbox card, is open to them for `approvePlan`, `requestChanges`, `acceptStaging`, `approveProduction` and `decide` only.

## Workflow editor

Every checkpoint row has an "Asked" select, Bauherr or Product owner, in `Asked.tsx` in the step panel for the triage, plan, release and `human` steps. `setAsked` writes `{by: product-owner}` or the plain forms. The top strip groups points by who is asked. Review changes says who is asked now, `describeChanges`.
