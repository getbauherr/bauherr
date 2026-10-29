# pack

OSS core pack: content, not code. Name `core`, version `0.1.0` (semver, released with Bauherr).

## Layout
```
pack.yaml            manifest: layers, skills, rules, hooks, purposes
skills/<name>/       Agent Skills folders (SKILL.md + references/)
rules/*.md           markdown rules with globs/applies front matter
hooks/               hook stubs + hooks.yaml (SDK event mapping)
```
Spec that links to all of it: [docs/spec/workflow.md](../docs/spec/workflow.md).

## Layers
core (this pack) → stack (optional sub-packs, e.g. `pack/stacks/laravel`) → client (the Workspace's Knowledge repo). A later layer appends; client wins on conflict.

## Materialisation
The Runner copies the resolved pack into the Run worktree at Run start (`.claude/`, `AGENTS.md`, rules). It is never committed to the Product repo. A Product repo's own committed config takes precedence over the pack. Decision: #7.

## Hooks
Stubs: argument parsing, decision shape, a TODO for the real check. The Runner supplies the environment named in `hooks/hooks.yaml`; the agent never does.

## Lint (future)
```sh
bauherr pack lint [--config pack/lint.yaml]
```
Will check size caps, front matter, manifest paths, and token budget. Not implemented in v0.1.
