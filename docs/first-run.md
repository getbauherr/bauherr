# First succeeded Runs (#40)

Real model, tier `cheap` (`claude-haiku-5-5`) through the gateway, Workspace `getbauherr` (budget 2 USD / 30 d, unchanged). Ticket [getbauherr/bauherr#70](https://github.com/getbauherr/bauherr/issues/70) "Add CHANGELOG.md".

## Result

| Step | Result |
|---|---|
| Ticket created with `bauherr:stage:plan` (16:58:47 UTC) | plan Run 1 queued 14 s later (poller) |
| Plan Run 1 | `succeeded`, 35 s; 18 in / 4 387 out / 161 401 cache tokens; gateway cost 0.0630 USD (Runner estimate 0.0063) |
| Plan Comment | first line `<!-- bauherr:plan -->`, sections `## Goal` and `## Steps`; worklog Comment `<!-- bauherr:worklog -->` holds the Ticket's Goal |
| Label `bauherr:approved:plan` (17:05:30 UTC) | poll sets stage `build` (derived event, spec §3) and queues Build Run 2 33 s later |
| Build Run 2 | `succeeded`, 40 s; 14 in / 3 818 out / 105 235 cache tokens; gateway cost 0.0505 USD (estimate 0.0051) |
| MR | [getbauherr/bauherr#71](https://github.com/getbauherr/bauherr/pull/71) (branch `bauherr/70-2`, only `CHANGELOG.md`, `## Evidence` section, not merged) |
| Ticket after Build | comment `Link: <MR>`, worklog updated in place, stage `bauherr:stage:review` |

Total gateway cost 0.1135 USD.

## Changes

- Plan: the Runner rewrites the Goal to `.bauherr/plan.md` statements, posts the file as the plan Comment, writes the Ticket's Goal into the worklog Comment, returns `succeeded`. `run-contract` skill updated.
- Build: Goal = acceptance criteria (default per stage when absent); Runner commits, pushes with the PAT, opens the MR with `## Evidence`, posts `Link:`, updates the worklog, sets stage `review`. Build Runs get the worklog and plan Comment as context.
- `RunCtx.forge` gained `upsertWorklog` and `setStage`.
- Poll: no in-app `autoRun`; compose service `poller` runs `jobs:poll` (`jobs:run --queue poll --handle-schedules`, 5 s tick, schedules fire per minute). Separate from `worker` because `payload jobs:run --cron` uses `protect: true`: one process running an agent Run would skip poll ticks.
- Admin login: cause was a stale password. The seed never updated an existing user and the password file was regenerated after the first seed. Seed now resets password and role on every run and accepts `BAUHERR_ADMIN_PASSWORD_FILE` (trimmed). `POST /api/bauherren/login` returns 200.
- Migration: one squashed initial migration incl. session-mode schema (`runs.mode`, `heartbeat_at`, Workspace mode fields). A fresh `bauherr` DB on the production image starts with no 42P01. An existing DB with the old migration must be recreated.

## Commands

```bash
docker compose build && docker compose up -d
export GITHUB_TOKEN="$(gh auth token)" BAUHERR_ADMIN_EMAIL=<email>
docker compose run --rm --no-deps -T \
  -v ~/.config/bauherr/anthropic-key:/run/anthropic-key:ro -e ANTHROPIC_API_KEY_FILE=/run/anthropic-key \
  -v ~/.config/bauherr/admin-password:/run/admin-password:ro -e BAUHERR_ADMIN_PASSWORD_FILE=/run/admin-password \
  -e BAUHERR_ADMIN_EMAIL -e GITHUB_TOKEN app sh -c 'cd /repo/apps/server && pnpm seed'
gh issue create -R getbauherr/bauherr --title "Add CHANGELOG.md" --label bauherr:stage:plan --body "<body>"
gh api -X POST repos/getbauherr/bauherr/issues/70/labels --raw-field 'labels[]=bauherr:approved:plan'
```

## Open

- `runs.cost_estimate_usd` is about 10x below gateway cost; `gateway_cost_usd` still null (reconcile not built).
- `gh issue edit --add-label` fails while the label does not exist in the repo; the adapter creates labels on add.
- Plan approval is not tied to the plan Run having succeeded.
- Catalog rates for the 5.5 models are placeholders.
