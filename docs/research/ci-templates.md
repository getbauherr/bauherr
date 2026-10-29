# CI templates for target repos (#20)

Proposal, nothing executed. Sources: #20, #7 resolution (items 6, 7, 9), `runner-execution-model.md` §4-5,
klima-portal `.gitlab-ci.yml` / `tools/docs-lint.sh`, ai-tooling `evals/README.md`. `[unverified]` = not checked.

## 1. Delivery mechanism

| | GitHub | GitLab |
|---|---|---|
| Recommend | **Reusable workflow** `getbauherr/bauherr/.github/workflows/bauherr-ci.yml@v1` | **`include: project:`** with `ref: v1.x.y` from a gitlab.com mirror of the CI repo |
| Why | Multi-job, own permissions, central logic. Composite action = steps only (no jobs, no `permissions`). Copied template drifts (the klima-portal `docs-lint` fork problem #7 fixed). | Works on Free, no catalog publishing step. |
| Alternative | Starter workflow (org `.github` repo) is a copy: scaffolding the caller only. | CI/CD components: Free, `Tier: Free, Premium, Ultimate`; refs `@sha`/`@tag`/`@~latest` ([docs](https://docs.gitlab.com/ci/components/)). Needs the component project on the consumer's instance; gitlab.com components on Self-Managed need Premium (same page). Revisit when inputs/versions matter more. |

GitHub ([reuse-workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)):

- Ref is SHA, tag or branch; "Using the commit SHA is the safest option". Ship moving `v1` + immutable `v1.2.3`;
  docs tell customers to pin the SHA with a `# v1.2.3` comment, Dependabot/Renovate bumps it.
- Secrets: pass named (`secrets:`), not `inherit` (inherit is same-org/enterprise only; over-broad). Secrets reach
  only the directly called workflow.
- Permissions "can only be maintained or reduced" down the chain; template needs `contents: read` only.
- `paths:` filters belong to the caller's `on:`. Gate inside (a `changes` job) so the path list is versioned
  centrally and a required check never stays "pending" from a filtered-out workflow.

GitLab: `include:project` + `ref` + `file` ([includes](https://docs.gitlab.com/ci/yaml/includes/)); `rules:changes`
in the included file gates centrally. Self-Managed: mirror, or `include:remote` to a pinned raw URL. [unverified]

Gateway credential (both): CI secret `BAUHERR_GATEWAY_KEY` + variable `BAUHERR_GATEWAY_URL`. Not OIDC: the gateway
holds per-Workspace consumer keys with a spend cap (`runner-execution-model.md` §4.5, §5); OIDC needs the gateway
to trust forge JWTs (later). Use a **separate low-budget CI key**: the gateway budget is the hard cap, `--max-usd`
only a client estimate ("can overshoot", same doc).

## 2. Jobs

Jobs: `lint` (`npx bauherr@$VER pack lint`), `eval` (`npx bauherr@$VER eval`), `secrets`, `test` (opt-in), `sast` (GitLab only).

- **Tests.** No language-agnostic magic. Contract: one command, default `make test` (klima-portal has it; its CI
  runs `php artisan test --parallel` against Postgres services, `.gitlab-ci.yml` `.test_base`). The template runs `test-command` on a bare runner. Products needing services keep their own job (reusable workflows
  cannot declare `services:`) and mark it a required check. Per-stack packs may later supply a default command.
  Default: off.
- **Lint.** klima-portal wiring: `docs:check` job runs only on MRs touching `docs/**`, `CLAUDE.md`, `.ai/**`,
  `.claude/**`, lock files (`.gitlab-ci.yml` L357+) and calls `tools/docs-lint.sh` (cited paths exist, version
  drift vs lock files, size caps, removed trees, skill front matter, rules listed in index, token budget). #7 item
  7 turns this into `bauherr pack lint` with a config file; php/Boost checks move to the laravel stack pack. Lint
  is deterministic, no LLM, no secret needed, so it also runs on fork PRs.
- **SAST.** GitLab Free: `Jobs/SAST` works, Semgrep analyzer "All tiers"; Advanced SAST (cross-file) Ultimate;
  JSON artifact only, no MR widget ([docs](https://docs.gitlab.com/user/application_security/sast/)).
  klima-portal already includes it. GitHub: CodeQL default setup needs a public repo or GitHub Code Security
  ([docs](https://docs.github.com/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning)).
  So **do not bundle SAST in the GitHub template**: customers enable CodeQL
  default setup in repo settings (zero YAML), or add Semgrep OSS themselves. Bauherr is not a SAST vendor.
- **Secret detection.** GitLab: all tiers, runs scans + JSON artifact; MR report/vuln dashboard Ultimate
  ([docs](https://docs.gitlab.com/user/application_security/secret_detection/pipeline/)). GitHub: avoid
  `gitleaks/gitleaks-action` (needs `GITLEAKS_LICENSE` for organizations,
  [repo](https://github.com/gitleaks/gitleaks-action)); run the pinned gitleaks binary. Knowledge repos get it
  mandatory (client rules live there, #7 item 6).

## 3. Eval job

**Case format**, next to the skill: `pack/skills/<skill>/evals/<case>.yaml` (client layer:
`workspace/skills/<skill>/evals/`, `products/<slug>/...`).

```yaml
id: tdd-red-first
input: "Add a validation that target_year >= 2020. Show your plan."   # user turn
checks: {must_match: ["(?i)failing test"], must_not_match: ["(?i)skip the test"]}   # deterministic, first
rubric:                               # judged, each criterion pass/fail
  - {id: test-first, text: "Plan writes a failing test before the implementation.", weight: 2}
  - {id: scoped, text: "Does not touch files outside the validation.", weight: 1}
```

**Runner**: own minimal `bauherr eval` (~200 lines), single-shot, **no tools**. Per case: (1) subject call
`POST $BAUHERR_GATEWAY_URL/v1/messages` with the materialised pack (SKILL.md + rules, the same materialiser as
Run start) as system prompt, `x-api-key: $BAUHERR_GATEWAY_KEY`, header `X-Bauherr-Run: ci-<pipeline>` for
attribution (wire format verified in runner doc §5); (2) deterministic checks; (3) judge call with a different
(or larger) model, forced JSON `{criteria:[{id,pass,reason}]}`. Judge sees case + output, never the author's PR text.

- **Pass**: case passes when checks pass and weighted rubric score >= `case-threshold` (default 0.8). Job
  passes when pass rate >= `suite-threshold` (default 0.9) **and** no case that passed on `main` baseline
  now fails (baseline = `eval-results.json` artifact of the last `main` run, fetched via API; absent = no
  regression gate, first run only reports). LLM noise: temperature 0, 1 sample, a failing case is re-run once
  before it counts.
- **Cost cap**: `max-cases` (default 40), `max-usd` (default 2) aborts the job from token usage, gateway CI key
  budget as the real limit. Subject model default cheap-class, judge mid-class; both inputs.
- **When**: only if the diff touches `pack/**`, `.claude/**`, `AGENTS.md`, `CLAUDE.md`, `workspace/**`,
  `products/**`, `pack.yaml`; run only evals of changed skills, plus the full core suite when `pack.yaml` pin
  changes (core bump). Computed in the `changes` job (`git diff --name-only base...HEAD`).
- **Fork PRs**: no secrets, eval skipped with a notice; lint still runs. A same-repo branch writer can edit the
  caller and exfiltrate the key: low-budget CI key + GitHub `environment` (`bauherr-eval`). The eval has no tools,
  so PR-supplied skill text cannot read the key (unlike a Run).
- **Results**: job status + `$GITHUB_STEP_SUMMARY` table (per case: pass/score/failed criteria + `$ cost`);
  `eval-results.json` artifact; JUnit XML on GitLab (`artifacts:reports:junit`, shows in MR test tab on Free).
  **No MR comment in v0.1**: it needs a write token in CI and the Forge adapter lives in the Runner, not CI.
- **Existing convention**: ai-tooling `evals/README.md`: `evals/<slug>/` holds `/claude-api build-eval` output
  (cases, runner, `results.jsonl`), "Nothing here yet". Align: JSONL, one line per case.

**promptfoo instead?** Good CI story ([docs](https://www.promptfoo.dev/docs/integrations/ci-cd/): JSON/JUnit
output, `PROMPTFOO_CACHE_PATH`, scripted pass-rate gate, GitLab example) but: large dependency, own config dialect
to map onto Skill folders, gateway wiring via provider config, and the materialiser + regression logic stay ours.
Recommend **own runner for v0.1**; keep the case format neutral (`input`->`vars`, `rubric`->`llm-rubric`
[not covered in the fetched page]) so a converter is the switching cost.

## 4. Knowledge repo template

`lint` + `eval` + `secrets` only (no tests, no SAST), triggered on pull/merge requests to the default branch.
Eval scope: changed client skills, plus the core suite **with the client overlay applied** when `pack.yaml` changes.

Required check (#7 item 9): GitHub branch protection / ruleset with required status checks on `lint` and `eval`;
a skipped job (path-gated) counts as success per [docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
Branch restrictions on private repos need Team/Enterprise (same page; required-check availability on private Free
repos not stated there). GitLab: "Pipelines must succeed" is Free ([docs](https://docs.gitlab.com/user/project/merge_requests/auto_merge/)).
The CI check is necessary, not sufficient: the **Bauherr approval** for agent PRs is enforced by the Forge adapter
(it merges only after approval); a Bauherr's own admin-editor edits still pass lint+eval on the PR before merge.

## 5. Stubs

Caller (GitHub, in target repo):

```yaml
name: bauherr
on: {pull_request: {branches: [main]}}
permissions: {contents: read}
jobs:
  bauherr:
    uses: getbauherr/bauherr/.github/workflows/bauherr-ci.yml@<sha> # v1.0.0
    with: {repo-kind: product}          # product | knowledge
    secrets: {gateway-key: "${{ secrets.BAUHERR_GATEWAY_KEY }}"}
```

`getbauherr/bauherr/.github/workflows/bauherr-ci.yml`:

```yaml
name: bauherr-ci
on:
  workflow_call:
    inputs:
      repo-kind:        {type: string,  required: true}          # product | knowledge
      bauherr-version:  {type: string,  default: "1.0.0"}        # npx bauherr@<ver>
      gateway-url:      {type: string,  default: "https://ai.einsfuenf.de"}
      test-command:     {type: string,  default: ""}             # empty = no test job
      eval-model:       {type: string,  default: "cheap-default"}   # judge-model, max-usd likewise
    secrets:
      gateway-key:      {required: false}
permissions: {contents: read}
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs: {agent: "${{ steps.d.outputs.agent }}"}
    steps:
      - uses: actions/checkout@v4          # pin to SHA in the real file
        with: {fetch-depth: 0}
      - id: d
        run: |
          git diff --name-only "origin/${{ github.base_ref }}...HEAD" \
            | grep -Eq '^(pack/|\.claude/|workspace/|products/|pack\.yaml|AGENTS\.md|CLAUDE\.md)' \
            && echo agent=true >> "$GITHUB_OUTPUT" || echo agent=false >> "$GITHUB_OUTPUT"
  lint:
    needs: changes
    if: needs.changes.outputs.agent == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx --yes bauherr@${{ inputs.bauherr-version }} pack lint --kind ${{ inputs.repo-kind }}
  eval:
    needs: [changes, lint]
    if: needs.changes.outputs.agent == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    environment: bauherr-eval
    env:
      ANTHROPIC_BASE_URL: ${{ inputs.gateway-url }}
      ANTHROPIC_API_KEY: ${{ secrets.gateway-key }}
    steps:
      - uses: actions/checkout@v4
        with: {fetch-depth: 0}
      - run: >
          npx --yes bauherr@${{ inputs.bauherr-version }} eval
          --changed-vs "origin/${{ github.base_ref }}" --model ${{ inputs.eval-model }}
          --summary "$GITHUB_STEP_SUMMARY" --out eval-results.json
      - {uses: actions/upload-artifact@v4, if: always(), with: {name: eval-results, path: eval-results.json}}
  secrets:   # checkout (full depth) + pinned gitleaks binary: gitleaks detect --redact
    runs-on: ubuntu-latest
    steps: [{uses: actions/checkout@v4, with: {fetch-depth: 0}}, {run: "gitleaks detect --redact"}]
  test:      # if: inputs.test-command != ''; checkout + run the command
    if: inputs.test-command != ''
    runs-on: ubuntu-latest
    steps: [{uses: actions/checkout@v4}, {run: "${{ inputs.test-command }}"}]
```

GitLab `bauherr-ci.gitlab-ci.yml` (consumer: `include: [{project: getbauherr/ci, ref: v1.0.0, file: bauherr-ci.gitlab-ci.yml}]`):

```yaml
spec:
  inputs:
    repo_kind: {default: product}
    bauherr_version: {default: "1.0.0"}
    test_command: {default: ""}
---
include:
  - template: Jobs/Secret-Detection.gitlab-ci.yml
  - template: Jobs/SAST.gitlab-ci.yml        # product repos only; knowledge repos omit
.agent_paths: &agent_paths ["pack/**/*", ".claude/**/*", "workspace/**/*", "products/**/*", "pack.yaml", "AGENTS.md", "CLAUDE.md"]
bauherr:lint:
  stage: test
  image: node:24
  rules: [{if: '$CI_MERGE_REQUEST_IID', changes: *agent_paths}]
  script: ["npx --yes bauherr@$[[ inputs.bauherr_version ]] pack lint --kind $[[ inputs.repo_kind ]]"]
bauherr:eval:
  stage: test
  image: node:24
  needs: ["bauherr:lint"]
  rules: [{if: '$CI_MERGE_REQUEST_IID && $CI_MERGE_REQUEST_SOURCE_PROJECT_PATH == $CI_PROJECT_PATH', changes: *agent_paths}]
  variables: {ANTHROPIC_BASE_URL: $BAUHERR_GATEWAY_URL, ANTHROPIC_API_KEY: $BAUHERR_GATEWAY_KEY}
  script:
    - npx --yes bauherr@$[[ inputs.bauherr_version ]] eval --changed-vs "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --out eval-results.json --junit eval.xml
  artifacts: {when: always, paths: [eval-results.json], reports: {junit: eval.xml}}
# bauherr:test: runs inputs.test_command when non-empty (same shape as lint)
```

## 6. Open risks

- `bauherr` npm package/CLI (`pack lint`, `eval`, materialiser) does not exist yet; everything above depends on it. Ship lint first.
- Judge flakiness: thresholds are guesses until measured on the core pack's first cases.
- GitLab Self-Managed needs a mirror or `include:remote`; the stub's `$[[ ]]` inside `rules:if` is untested.
- GitHub private repos on Free: CodeQL unavailable, required checks unconfirmed; fallback is Bauherr-side approval.
