# Setup wizard, presets and editable templates

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `/setup` (Admin only, shown while a Workspace has no Product) walked through steps. The commit and docs call it five steps; `SETUP_STEPS` in the code lists six: forge, product, team, session, request, verify. Required: forge, product, request. Session and verify could be skipped (`setup:skip-session`, `setup:skip-verify`).
- Forge: a Connection form and `verifyConnection`. Product: pick a repository and create the Product with its repository and ticket source (`createProductWithRepo`). A forge Connection in working use counted as connected.
- Team: three presets, `solo` (one engineer, plans pass without approval), `standard` (orchestrator triages, engineer builds, reviewer checks, owner approves plans), `careful` (standard plus acceptance on staging and specialist reviews). `applyPreset` wrote the preset's workflow file for the Workspace and showed its roster and asks first.
- Session: connect a Claude Code session as a role (copy prompt, list sessions). First request: import an existing issue (`importIssue`). Verify: generate the verification skill for the Product (`generateVerification`, #728).
- A rail showed done steps; the shown step was the first open one, earlier ones could be reopened.
- Templates: nine texts in `pack/templates/` (`request`, `plan`, `decision`, `review`, `staging-summary`, `release-note`, `worklog`, `triage-questions`, `progress`), each with front matter (title, used_by, description, layout) and sections with anchors. Settings > Templates let a Workspace override one (`saveTemplate`, `resetTemplate`, table `templates`, one row per Workspace and name). Agents got the same structure appended to their skill (`SKILL_TEMPLATES`).
- The plan's TL;DR was found by the Workspace template's current heading text.

## The requirement behind it

- A new owner must get from nothing to a first Ticket in one place (#499).
- The team shape (who plans, builds, reviews, who approves) must be a choice with a plain description, not a YAML edit.
- The texts the factory writes for people should be editable per Workspace and equal what agents are told to write (#490, `template-parity.test.ts`).

## Where the code is

- `apps/server/src/app/(app)/(shell)/setup/` (page.tsx 138, actions.ts 69), `app/(app)/lib/setup-steps.ts` (41), `setup.ts` (43), `product-setup.ts` (94).
- UI: `apps/server/src/app/(app)/components/setup/` (IssuePick, PresetPicker, ProductPick, RepoOptions, SessionConnect, SetupRail, StepCard), `NewProductForm.tsx`, `SettingsConnectionForm.tsx`.
- `apps/server/src/lib/presets.ts` (57: `PRESETS`, `presetWorkflow`, `presetFacts`, `rosterOf`); `pack/presets/solo.yaml`, `standard.yaml`, `careful.yaml`.
- Reused actions live in `apps/server/src/app/(app)/(shell)/settings/actions.ts`: `saveConnection` (line 330), `verifyConnection` (400), `createProductWithRepo` (277), `saveTemplate` (534), `resetTemplate` (547).
- Templates: `apps/server/src/lib/templates.ts` (51), `template-text.ts` (93), `app/(app)/lib/templates.ts` (19), `components/TemplateEditor.tsx` (69), `(shell)/settings/templates/` (page, [name]/page), `pack/templates/*.md`.
- Collection `templates` (name, body, updatedBy; unique per workspace and name) in `apps/server/src/collections.ts`.
- Tests in `apps/server/tests/`: `setup.test.ts`, `setup-steps.test.ts`, `setup-wizard.test.ts`, `template-parity.test.ts`, `templates.test.ts`.
- Docs: `docs/spec/intake.md` (Templates), `docs/first-run.md` (the first manual run, not the wizard), `docs/ui.md`.

## Why it was cut

The lean core replaces it with a four-step onboarding for existing projects (connect, import, first look, switch on) and has no editable templates, because cards are rendered from the record.

## What a module on the new core needs

- Core contracts: the forge writer (connection check), the mirror (import of existing issues and PRs), the Ticket record for "first look", and the module registry for "switch on".
- Reused by the new onboarding as they are: `saveConnection`, `verifyConnection`, `createProductWithRepo` in `settings/actions.ts`. Liftable: `stepsOf`, `shownStep`, `needsSetup` (pure, `setup-steps.ts`), the `SetupRail` and `StepCard` components.
- To design again: presets only if the team shape stays configurable (the lifecycle is fixed, so most of `presetFacts` and `rosterOf` has no input); a template module would need cards or documents rendered from a record, with a parity check between what people see and what agents are told.
- Traps: `template-parity.test.ts` exists because the editable text and the agent text drifted (inferred from the test name); the step list and its docs disagreed (five vs six); a connection "in working use" must count as connected or the wizard reopens; applying a preset overwrites the Workspace's workflow file (inferred, `applyPreset`).
- Seen in souls-house ([Host your own](https://github.com/swombat/souls-house#host-your-own)): the install guide is written for the reader's coding agent ("read this file and walk me through the next step"), and a `doctor` command checks DNS, Docker, memory and disk before anything is deployed.
