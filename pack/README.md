# pack

OSS core pack: content, not code. Name `core`, version `0.1.0` (semver, released with Bauherr).

## Layout
```
pack.yaml            manifest: layers, skills, rules, hooks, purposes
skills/<name>/       Agent Skills folders (SKILL.md + references/; optional mode parts session.md and autonomous.md, each served only to its own mode)
presets/*.yaml       factory files the setup wizard offers: solo, standard (factory.yaml plus a conditional security review), careful (conditional security, UX and test reviews)
templates/*.md       text structures for people (request, plan, decision, review, staging summary, release note, worklog, triage questions, progress)
rules/*.md           markdown rules with globs/applies front matter
hooks/               reference stubs (not active) + hooks.yaml (SDK event mapping)
```
Spec that links to all of it: [docs/spec/workflow.md](../docs/spec/workflow.md).

## Templates
One file per text the factory or its agents write for people: front matter (`name`, `title`, `used_by`, `description`) and `## Heading {#id}` sections, each with a guidance comment. A Workspace can override each in Settings > Templates; `load_skill` and the Runner append the effective ones to the skills that write them. Default templates reproduce the factory's own output exactly.

## Layers
core (this pack) → stack (optional sub-packs, e.g. `pack/stacks/laravel`) → client (the Workspace's Knowledge repo). A later layer appends; client wins on conflict.

## Materialisation
The Runner copies the resolved pack into the Run worktree at Run start (`.claude/`, `AGENTS.md`, rules). It is never committed to the Product repo. A Product repo's own committed config takes precedence over the pack. Decision: #7.

## Hooks
`stop-goal-check.ts`, `write-scope-guard.ts` and `egress-guard.sh` are reference stubs and are not active: nothing loads them. For autonomous Runs the Runner enforces the same three checks in code (`packages/runner/src/guards.ts`, `goal.ts`, `agent.ts`); session Runs have none of them. A rule says what enforces it today and never cites a stub as enforcement (`bauherr pack lint` checks that).

## Lint
```sh
bauherr pack lint [--pack pack] [--context CONTEXT.md] [--spec docs/spec/workflow.md]
```
Run from the repo root, in CI (job `cli`); exit 1 with one sentence per finding (`file:line: ...`). Checks:
1. Size caps per file kind (lines and bytes): role profile 40 / 3000, rule 60 / 4000, skill file 100 / 6000, template 70 / 4000, hook 50 / 3000, factory file or preset 60 / 4000 (`CAPS` in `packages/cli/src/lint.ts`).
2. Every path rooted at a pack folder (`rules/`, `skills/`, `hooks/`, `templates/`, `roles/`, `presets/`, `stacks/`) or linked with `./` or `../` inside the pack exists. Any other path (`docs/…`, `.bauherr/…`, `src/**`) is a Product or runtime path and is not checked; the core names none of a single Product's.
3. Terms of two or more words that `CONTEXT.md` lists under *Avoid* (without a qualifier) do not appear. Single everyday words (owner, session, task) stay with the reviewer.
4. The tiers of `factory.yaml` and every preset equal the `| Role | Tier |` table of the spec.
5. No stack or language name (`STACK_TERMS`, one list) outside `stacks/`.
6. A rule, skill or the spec that cites a hook file as enforcement cites one that is implemented; a stub (contains `TODO` or "not active") may only be named on a line that says "not active" or "not enforced".
