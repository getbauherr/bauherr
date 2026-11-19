# Agent team page, sessions and presence

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `/team` listed the roles of the factory file (`team.roles`: orchestrator, engineer, reviewer, security, ux, test, docs, ax, verifier) with title, skills, model tier and an agent limit. An Admin edited a role's model and limit in a drawer, which rewrote the factory YAML (`withRoleSettings`).
- Connect panel: choose a role, copy a prompt, paste it into a Claude Code session that has the Bauherr MCP server. The session showed as Idle, then Working when it claimed a Run. `/team/[id]` showed one session: current Run, milestones, cost.
- `connect {role, session?, label?}` created an `agent_sessions` row (`publicId` `ses_...`). The same `clientKey` of an owner in a Workspace revived the row. `next_work` pulled Runs by role; `disconnect` released held Runs.
- Presence: every call set `lastSeenAt`, at most every 15 s. A session was working with a running Run, idle when seen within `BAUHERR_SESSION_TIMEOUT_S` (default 600), and ended `timeout` after that. `sessionHealth` also named stuck and not-responding. Ended sessions stayed visible 24 hours. A sweep ran every 5 minutes.
- A span (`session_spans`) was the time a session held a Run, opened at claim, extended by each call, forced at finish, release, disconnect. Active time per role and session was the sum, shown in Insights "Team" and as utilisation.
- Presence pill in the shell header: "N working, M idle", polled from `/api/presence` every 5 s. A role with waiting Runs and no live session showed "needs an agent".
- An exceptions role (`exceptions: true`, the Orchestrator) received stuck Tickets from `next_work`; the only repair was `return_to_build`.

## The requirement behind it

- Let a developer's own Claude Code session work as a role, with their credentials, and see it in the factory (#494).
- Show who is working and what each session does (#497); who is working visible on every page (#505).
- Count agent time and cost per session and role (#497, #503).
- Show when a stage has no one to run it, instead of silent waiting (#508).

## Where the code is

- `apps/server/src/lib/sessions.ts` (424: `connect`, `nextWork`, `touch`, `sweepSessions`, `sessionHealth`, `loadTeam`, `loadSession`, `sessionTime`), `presence.ts` (27), `session-usage.ts` (148), `apps/server/src/app/(app)/lib/team.ts` (45), `executors.ts` (who runs a stage).
- Routes: `apps/server/src/app/(app)/(shell)/team/` (page 36, actions.ts, [id]/page.tsx), `app/api/presence/route.ts`.
- UI: `apps/server/src/app/(app)/components/team/` (TeamView, RolesTable, RoleSettings, ConnectPanel, SessionList, SessionRow, AgentView, RoleAvatar, helpers.ts, agent-status.ts), `components/Presence.tsx` (62), `components/setup/SessionConnect.tsx`.
- Collections in `apps/server/src/collections.ts`: `agent_sessions` (publicId, owner, agentKey, role, label, clientKey, clientName, clientVersion, provider, model, connectedAt, lastSeenAt, disconnectedAt, endReason), `session_spans` (session, run, ticket, startedAt, lastAt); `runs.session`; `usage_entries.session`, `usage_cursors`.
- MCP tools `connect`, `next_work`, `heartbeat`, `disconnect` in `apps/server/src/lib/mcp-tools.ts`; roles in `pack/factory.yaml` and `pack/roles/*.md`.
- Tests in `apps/server/tests/`: `agent-sessions.test.ts`, `migrations-agent-sessions.test.ts`, `presence.test.ts`, `session.test.ts`, `team-connect.test.ts`, `team-data.test.ts`, `team-helpers.test.ts`, `agent-status.test.ts`, `stage-jobs-sessions.test.ts`.
- Docs: `docs/session-mode.md`, `docs/spec/sessions.md`, `docs/ui.md` (Agent team).

## Why it was cut

The Factory view shows who is working on each stage; a separate team page is not needed for three roles. The new core keeps session leases (`agent_sessions`).

## What a module on the new core needs

- Core contracts: the Run contract and the MCP tools, with the session lease owned by the core. A module only reads leases and Run events; presence is derived, not stored.
- Liftable almost unchanged: `sessionHealth` (pure), `teamSummary`, `needAgent`, `defaultRole` (`components/team/helpers.ts`), `loadPresence`, `connectedOfRole`, `sweepSessions`, `withRoleSettings`.
- To design again: `loadTeam` joins roles, sessions and Runs of the old workflow engine; it must read lease and event data of the new core. Spans could be computed from events instead of a table (inferred). Role settings must not rewrite a factory YAML if roles are fixed.
- Traps: write `lastSeenAt` at most every 15 s or the table churns; end a timed-out session only when no Run is running; a Run that loses its lease keeps its last signal for span time; the unique index `workspace, owner, clientKey` makes reconnect revive the row; role ids in `agent_sessions.role` can outlive the factory file (inferred from the free text field).
