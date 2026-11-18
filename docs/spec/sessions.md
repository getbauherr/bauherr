# Agent sessions, executors and system Runs

## Agent session

An agent session, table `agent_sessions`, is a connected client such as Claude Code working as one role.

- `connect` registers it with `publicId` `ses_...`, role, `clientKey`, client and reported model. The same `clientKey` of an owner in a Workspace revives the row.
- `next_work` pulls the next Run of a stage whose `role` is the session's, through the `claim_next` path. Stage mode, WIP and the role's `agents` cap apply. At the cap, or with nothing queued, it answers a plain reason.
- Every agent tool takes an optional `sessionId`. `disconnect` ends the session and releases its Runs.
- Without `sessionId` the legacy claim and its 30-minute lease are unchanged.
- A claimed Run carries `runs.session`, `role`, `model`, `provider`, `clientName`, `clientVersion` and `executor: session`. The history event's actor is `<label> (<role>)`.

## Presence

Each call writes `lastSeenAt`, at most every 15 s.

- A span is the time a session holds a Run: one `session_spans` row per session and Run. It opens at the claim, is extended by every call for the Run, and is forced at finish, release and disconnect. A Run that loses its lease keeps its last signal. Active time is the sum of span durations.
- A session with no running Run, silent for `BAUHERR_SESSION_TIMEOUT_S`, default 600, ends with `endReason: timeout`. The sweep in the liveness task, every 5 minutes, does it.
- `loadTeam(payload, workspace)` reads roles, sessions and autonomous Runs per role from the database only. A session is `working` with a running Run, `idle` when seen within the timeout, and `offline` when disconnected, kept 24 hours.

## Exceptions role

One role has `exceptions: true`. When nothing normal is claimable for it, `next_work` returns the next stuck Ticket as `{exception: {ticket, problem, since, allowed}}`.

- The data comes from `tickets.liveness`, database only, ignoring findings older than 15 minutes. `since` is the Ticket's last update.
- `allowed` is what an agent may do today: `return_to_build` for `mr-missing` and `checks-red`. It never includes a human gate tool. It is empty for causes the owner decides or the factory repairs.

## Who executes a stage

`executorOf(stage, facts)` in `lib/executors.ts` is pure. `executorsOf` supplies facts from the database only: sessions by role, Runs `awaiting_session` per stage, the Products' deploy settings and the Workspace's last `releasedAt`. It gives each stage one line and at most one action. `done` and `container` stages have none. First match wins.

| Stage has | Line | Action |
|---|---|---|
| A role with connected sessions | "`<role title>` · N working · M idle" | None |
| A role, none connected | "`<role title>` · none connected, N Runs waiting" | "Connect a `<role title>`" at `/team?role=<id>`, cannot run |
| Kind `release`, no role | "GitHub Actions", "GitLab CI" or "Product CI", "last deploy `<ago>`" or "no deploy reported yet" | With no deploy check: "no deploy check configured", action "Configure deploy checks", cannot run |
| A human gate, no role | "You" | None |
| Anything else | "No one assigned" | "Edit workflow", cannot run |

- "Working" means on a Ticket in this stage. Idle and connected count the whole role.
- A Ticket row's Who column says why it waits, `waitingWho` in the same file. An open Ticket not being worked, in a stage that cannot run, shows "Waiting for a `<role title>` session" or "Waiting for the Product's deploy check".
- A Ticket in `release` with `releaseState: timed_out` shows the deploy-check text too, while "Staging not confirmed" still fires.
- A Ticket waiting at a gate keeps its gate people. Otherwise the column shows the status's own `who`.
- Factory health adds one `cannot-run` hold, `holdsOf` in `lib/holds.ts`, when a stage whose executor cannot run has open Tickets waiting in it, with no `needsYou` and not parked. Text "1 stage cannot run" or "N stages cannot run", linking the Workflow view with each cause. A healthy factory adds nothing. No forge call.

## Docs check Run

An Admin starts it with Product > Docs > Check docs now, on the Product's anchor Ticket labelled `bauherr:docs-check`. Triage excludes that label.

- The Run is autonomous and read-only. A session cannot claim it. It never escalates, a failure goes to the owner.
- Its context lists `products.docsCheck.paths` and every Ticket that entered Release with a merge commit since `docsCheck.lastCheckAt`. The first check counts from the last release, else 30 days.
- It writes `.bauherr/docs-findings.json` with `stale` and `missing` lists. A bad file, or one naming a Ticket or commit outside the list, fails the Run and files nothing.
- Findings file one Ticket, "Docs update", with labels `bauherr:docs` and `bauherr:type:change`, stage Plan, one criterion per finding and at most 30. An open `bauherr:docs` Ticket with an older marker or none is updated in place.
- Zero findings files nothing and records the check.

## Distill

The `distill` stage is a job-driven Run without an agent session. It starts when a review merges a Ticket that went back to Build, or that a later fix names.

- It proposes one skill as a Knowledge-repo PR on `bauherr/<run-id>` and replays it against its own eval cases. The baseline without the skill must fail. With it the score must be at least 0.9, and at least 0.8 per case.
- Caps: 1 extraction call, 60 KB in and 2k out. 20 eval calls per suite, $1 per distillation, 5 per Workspace per day.
- The factory never merges the PR. `skill_proposals` holds the status.
- Only an Admin approves, with `approveSkillProposal` or the human-only MCP tool `approve_skill_proposal`. It merges with `expectSha`, refuses a moved head, records the touch `approve:skill` and sets `accepted`. Only `proposed` or `replayed` proposals qualify.
- `watchKnowledgePrs` handles only `bauherr/edit-*` and never touches these PRs.
