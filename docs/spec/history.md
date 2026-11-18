# Jobs and history

## Jobs

A Workflow is an ordered list of Stages. A Stage is a DAG of Jobs. "Step" is reserved for the recorded unit inside a Run.

- Every Stage has one own Job, id equal to the stage name, from its `role` and `skill`. A Stage may instead list explicit `jobs`.
- When all Jobs are done the Stage applies its first outcome. A failed blocking Job stops the Stage. A repair Run re-runs failed Jobs only.
- An agent Job is executed by a Run. Explicit Jobs have `runs.kind=agent` and `runs.job=<id>`. The own Job keeps the Stage's Run kind and an empty `job`.

| Job key | Meaning |
|---|---|
| `id` | `^[a-z][a-z0-9-]*$`, unique, not the Stage name |
| `role` | A key of `team.roles` |
| `skill` | A pack skill |
| `needs` | Earlier Jobs of the Stage that must be done or skipped first |
| `when` | Path set, paths, labels or request types. No match means skipped, which counts as done |
| `blocking` | Default true: a non-done outcome decides the Stage now. False: the mapping is only recorded |
| `outcomes` | Job outcome to `done` or an outcome key of the Stage. At least one maps to `done`. Default: the Stage's first outcome to `done`, the others to themselves |

- `kind` is `agent` only. `ci`, `check` and `human` are refused as unsupported. `jobs` on other Stage kinds is refused.
- A Stage with `jobs` has no `role` or `skill` of its own.
- Starting Jobs, outcome mapping and cancelling siblings are in progress. Until then a Stage with `jobs` is accepted but runs no Jobs.
- The base workflow is `pack/factory.yaml`, read-only in the UI. A per-Product overlay `products/<slug>/workflow.yaml` in the Knowledge repo is merged into the compiled DAG, which Runs reference through `workflow_versions`. `bauherr pack lint` validates it.

## Ticket events

Every change of a Ticket's `stage|phase` appends a row to `ticket_events`, which is append-only.

| Field | Content |
|---|---|
| `ticket`, `at` | Which Ticket, when |
| `stage`, `stageKind`, `phase`, `fromStage` | Where the Ticket is from then on, and where it came from |
| `outcome`, `run` | What caused it |
| `executor` | `session`, `runner`, `ci`, `human` or `factory` |
| `actor` | Person or session label |
| `cause` | Short machine reason: `moveStage:request_review`, `run:claimed`, `run:finished`, `gate:approve:plan`, `poll`, `sweep`, or `skip:<stage>` with the reason in `note` |
| `workflowVersion`, `backfilled` | Reserved, and set by the backfill |

- `tickets.historyKey` holds the newest `stage|phase`. `record` in `lib/history.ts` inserts an event only when one conditional UPDATE of that key changes it. Concurrent callers write a change once, and it never throws into the caller.
- An event's span ends at the next event, or now for the newest. A `closed` event has none.
- A Ticket without a stage label is in the triage stage.
- A `skip:<stage>` event does not touch `historyKey` and is left out of spans and flow metrics.

Phase is the first match of `phaseOf`:

| Phase | When |
|---|---|
| `closed` | The Ticket is closed or in the done stage |
| `working` | A Run of the Ticket's stage is running |
| `queued` | A Run is queued or awaits a session |
| `human` | It needs the owner, `needsOf`, the gate sweep's input |
| `ci` | Waiting for checks, the merge queue or a deploy: `waitingFor` is checks, review is `waiting_checks` or `queued`, release is `waiting`, production is `deploying`, or release checks are `waiting` |
| `queued` | Otherwise |

Events are written by:

- `moveStage`, for every factory stage move, with its `why`.
- The poller's Ticket upsert.
- The Run lifecycle: queued, claimed, finished, released, abandoned, and the Runner's start and end.
- Human gate actions, as `gate:<touch kind>` with `executor: human`.
- Release and production state changes.
- The minutely gate sweep, `cause: sweep`, which repairs a missed hook within a minute.

Migration `ticket_history` backfills Tickets from creation, Runs and approvals, with `backfilled = true` and no exact stage-entry times.

## Flow metrics

`flow()` in `lib/history.ts` covers Tickets whose first event is in the window.

| Metric | Definition |
|---|---|
| Lead time | First event to the first `closed` event |
| Cycle time | First event outside the triage stage to the first `closed` event |
| Time in stage | Sum of a stage's spans, split by phase, with median and p85 per stage and phase |
| Throughput | Tickets reaching done per ISO week |

## Usage and Run records

`usage_entries` hold tokens and cost per Run and model. See [cost](../cost.md).

| `source` | Meaning |
|---|---|
| `gateway` | Reconciled from the gateway, replaced on re-run |
| `session-reported` | Cumulative `usage` of a session tool call, or the usage hook's delta. Ignored for a Run the gateway priced |
| `chat` | Read from `chat_messages.answer` |

- `usage_cursors` holds the hook's cursor per session and Claude session.
- A Run records its `executor`, `session` or `runner`, `clientName` and `clientVersion` from the `client` argument of `claim_run` or `claim_next`, else the MCP `User-Agent`. It also records `model` and `provider`, `role`, and `outcome`, which is reserved.
- `steps.finishedAt` is set when the next Step starts or the Run ends.
