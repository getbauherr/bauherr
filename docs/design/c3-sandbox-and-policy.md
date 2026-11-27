# C3: Sandbox and policy

Plan row C3: where runs execute, what they may reach, live bug reproduction at Intake. Decision paper for the Bauherr. Facts are read from the code at `56182279`; prices and limits from the vendor pages linked in section 3, read 2026-11-27.

## 1. Recommendation and decisions

**Recommendation.** Keep runs on the Bauherr's own host, but stop running the agent as a child of the worker with the worker's rights. First PR: the agent runs as its own unprivileged user inside the Claude sandbox (bubblewrap) with a scrubbed environment and no secrets mounted, proof commands run the same way, and the worker container is hardened. Container-per-run with gVisor comes next, only when one instance serves several unrelated customers. Hosted sandboxes stay out of v1.

**Decisions** (recommendation first):

1. Runs execute on the Bauherr's own host; hosted sandboxes (e2b, Claude Managed Agents cloud) are out for now. Yes / no.
2. Network default for a run: nothing except the gateway. A Product opts in to registry presets (npm, pypi, crates, go, maven) and extra hosts. Yes / pick "open registries by default".
3. Branch protection on the default branch becomes a blocker for `executor = runner` (today a note). Yes / no.
4. Spend per run: keep $5, 80 turns, 25 minutes as defaults, let a Product lower them, and enforce the cap at the gateway with a per-run key in a later PR. Yes / no.
5. Live reproduction at Intake: opt-in per Product, off by default, only for bug reports that have steps, needs a staging URL and a test account. Yes / no.
6. Claude Code sessions over MCP count as the owner's own machine and are out of C3's sandbox; the server-side verification gate is their control. Yes / no.

## 2. Today

### 2.1 Where a run executes

There is no container per run. The `worker` compose service runs `pnpm jobs` (`compose.yaml:85-87`), claims queued runs of Products with `executor = 'runner'` (`apps/server/src/jobs/runner/index.ts:19`) and works up to `BAUHERR_MAX_RUNS`, default 2 (`jobs/runner/deps.ts:23`), in its own process. The Dockerfile has no `USER` and compose sets none for the worker, so it runs as root, with `DATABASE_URL`, the secrets volume (`compose.yaml:12`, `/run/secrets` holds `payload_secret` and `encryption_key`) and the decrypted Workspace gateway key in reach (`deps.ts:98`).

Per run (`jobs/runner/work.ts:167-186`): shallow clone into `mkdtemp` (`packages/runner/src/clone.ts`, depth 50), the Claude Agent SDK as a child process with `cwd` in the clone and `HOME` in the temp dir, then the Runner commits, pushes and opens the pull request itself (`jobs/runner/plan.ts:80-117`), then deletes the directory.

### 2.2 What a run gets

| Item | Today | Source |
|---|---|---|
| Agent env | Only `PATH`, `HOME`, `ANTHROPIC_BASE_URL` (local proxy), dummy key | `packages/runner/src/agent.ts:43-51` |
| Gateway key | Workspace key, injected by a loopback proxy in the worker; the agent can still spend through the proxy | `packages/runner/src/proxy.ts:27` |
| Forge token | Only in the Runner's own `git` env (`GIT_CONFIG_*`), never in the agent env; GitHub App token expires after 1 h | `clone.ts` `gitEnv`; `lib/adapters.ts:63-66` |
| Token scope | Whatever the Connection holds (App installation or PAT); not narrowed per run | `lib/adapters.ts:63-66` |
| Tools, Build | Read, Grep, Glob, Edit, Write, Bash; auto-allowed: `git status/diff/add/commit`, `npm test`, `npm run` | `agent.ts:61-76` |
| Tools, Intake/Brief | Read, Grep, Glob, Write; writes only under `.bauherr/` | `agent.ts:61`; `jobs/runner/work.ts:21`; `deps.ts` `writablePaths` |
| Denied | WebFetch, WebSearch, `git push`, curl, wget, ssh, printenv, env | `agent.ts:31-41` |
| Hooks | Write scope (inside cwd, not `.git`), egress regex, spin detection (3 identical Bash results) | `guards.ts:19-40`, `hooks.ts` |
| Claude sandbox option | Not set (`sandbox` appears nowhere in `packages/runner/src`) | grep |
| Network | Same Docker network as `db` and `gateway`; no egress control at OS level | `compose.yaml` |
| Filesystem | Whole container; no read-only root, no tmpfs, no caps dropped, no memory or pid limit | `compose.yaml` |

### 2.3 Limits

| Limit | Value | Source |
|---|---|---|
| Turns / client-side cost / wall clock per agent turn | 80 / $5 / 25 min | `deps.ts:19-21` |
| Proof command timeout | 5 min each, max 50 proofs | `proofs.ts:16` |
| Lease | 30 min without heartbeat, then run expires | `core/run/leases.ts:11` |
| Caps | 3 verify rounds, 2 reporter rounds, 2 failed runs, then a Question card | `core/caps.ts:1` |
| Workspace spend | Monthly rolling 30 d, default $50 or 20M tokens, `Block` when exceeded; shared by Runner, chat and CI | `lib/gateway-admin.ts:53-59` |
| Session key | `SESSION_BUDGET_USD` default 100 per 30 d, `Audit` only: warns, does not stop | `gateway-admin.ts:91-93` |

`maxBudgetUsd` is a client-side list-price estimate that "can overshoot" (SDK docs, quoted in `docs/research/runner-execution-model.md` section 1). The hard stop is the Workspace key's monthly budget; there is no per-run key.

### 2.4 Claude Code sessions over MCP

A session is the owner's own Claude Code on the owner's machine. It `connect`s, pulls runs with `next_work` and submits (`core/run/mcp/registry.ts:13`: connect, next_work, heartbeat, search, attach_proof, fetch_file, ask, submit, release, decide). Bauherr does not control its shell, filesystem, network or forge credentials. What Bauherr does control is the result: the verification gate refuses a verdict without proof per criterion, from the patch author, for a stale patch or a moved head, and exit-code proof comes only from CI on the head or from the Runner (`CONTEXT.md`, Proof and Verification gate). The session uses an agent key, per Workspace, and can use the owner-session gateway key (budget `Audit` only).

## 3. Threats

| Threat | Today's mitigation | Gap |
|---|---|---|
| Prompt injection from issue or comment text | Context is written to files and labelled reference data (`workdir.ts` `PROMPT`); tools limited; pushes done by the Runner, not the agent; Brief approval by the Bauherr for risk areas | Model behaviour is the only control for what a Bash call does inside the allowed set; no OS boundary |
| Run exfiltrates secrets | Agent env has no secrets; token only in Runner git env | Same user as the worker: `/proc/<worker>/environ` (DB URL, key material) and `/run/secrets/*` are readable by Bash and by the Read tool; the research doc names this open risk 1 (`docs/research/runner-execution-model.md`, "Open risks"). Egress guard is a regex on `curl`, `wget`, `nc`, `ssh`, `git push` (`guards.ts:30`): `node -e`, `python -c`, `/dev/tcp` are not matched |
| Verifier proof commands | Runner runs them itself with a clean env, 5 min timeout, offline by regex (`proofs.ts:73-122`) | They are agent-authored shell run by the worker as the worker's user, outside the SDK permission system; "offline" is the same regex |
| Push to a protected branch | The agent has no token; Runner pushes `bauherr/<n>-<run>` only, `--force-with-lease` on an existing head (`plan.ts:104`, `clone.ts` `commitAndPush`); merge is gated by the Bauherr | Token scope is the Connection's, so Bauherr itself could push anywhere the App can; branch protection is only a note in Readiness (`core/readiness/checks.ts:189-197`) |
| Runaway cost | 80 turns, $5 estimate, 25 min, spin stop, 2 failed-run cap, Workspace budget `Block` | No per-run hard cap; two concurrent runs plus chat share one monthly pool; session key never blocks |
| Malicious dependency | `npm install` is not allowed, so nothing new is fetched | A repo script reached by `npm run` or `npm test` runs with the agent's rights; and because installs are blocked, Build cannot run most real test suites (no `node_modules`): a sandbox with a registry allowlist is what unlocks that safely. [unverified: how Build behaves on a repo without vendored deps; check on a sandbox repo] |
| Poisoned repository config | `settingSources: []`, `strictMcpConfig`, `core.hooksPath=/dev/null` (`agent.ts:58-59`, `clone.ts`) | Fine |
| Runs poison each other | Fresh clone per run, own `HOME`, deleted in `finally` | Same user, same `/tmp`; a run can read another run's checkout |

## 4. Options for where runs execute

Vendor facts below are from primary pages. The Claude docs call the isolation ladder "Sandbox runtime, Containers, gVisor, VMs" and rate strength as "Good", "Setup dependent", "Excellent (with correct setup)" ([secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)).

| | A. Today, hardened in place (uid split, bubblewrap, no secrets) | B. Container per run, optional gVisor | C. MicroVM (Firecracker-style) | D. Hosted: e2b | E. Hosted: Claude Managed Agents | F. GitHub Actions runner |
|---|---|---|---|---|---|---|
| Isolation | Shared kernel, process level. Docs: same-host kernel, "A kernel vulnerability could theoretically enable escape"; proxy checks hostnames and does not inspect TLS (domain fronting possible) | Namespaces; with `runsc` syscalls handled in user space, "Excellent (with correct setup)" | Own kernel; docs: boot "under 125ms", under 5 MiB overhead; security depends on hypervisor | "an isolated Linux VM for your agent" ([docs](https://docs.e2b.dev/docs/sandbox)); technology not named | "fresh Linux container" per session, network rules per environment ([docs](https://platform.claude.com/docs/en/managed-agents/environments)) | Fresh VM per job (GitHub-hosted) |
| Cost per 25 min run | $0 extra | $0 extra on own host; gVisor overhead: ~0 % CPU-bound, ~2x simple syscalls, 10-200x heavy file open/close | Own host capacity | Default 2 vCPU 4 GiB: 2 x 0.000014 + 4 x 0.0000045 = $0.000046/s, so about $0.07; Pro plan $150/month, 100 concurrent ([pricing](https://e2b.dev/pricing)) | Tokens plus $0.08 per running session-hour, so about $0.03 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | 2-core Linux $0.006/min, so $0.15 ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) |
| Start latency | None | Container start plus image pull, seconds | Under 1 s boot, plus image and orchestration to build | Not stated on the page read | Not stated on the pages read | Queue plus runner start; not stated |
| Operations | Low: one image change | Medium: needs a Docker socket (root-equivalent, `docs/research/runner-execution-model.md` section 2) or a socket proxy; gVisor install on the host | High: orchestrator, images, vsock proxy; nothing in the repo today | Low, but a vendor in the run path | Low, beta (`managed-agents-2026-04-01`), "not eligible" for ZDR and HIPAA | Medium: workflow dispatch, artifacts back, token handoff |
| Network control | bubblewrap allowlist for Bash only; file tools and the SDK process itself are not wrapped | Per-container: `--network none` plus a proxy socket; strongest of the self-hosted choices | vsock to host proxy | `allowOut` / `denyOut` with domains (HTTP 80 and HTTPS 443 only, no QUIC); deny list takes no domains | `limited` with `allowed_hosts`; a host is open for any request including `git push` | Egress open by default |
| Fit with the Runner | Direct: same code path, one new option | Good: Runner already has a clone, a proxy and a work dir; moves behind one `AgentRequest` seam | Same seam, more work | Poor: all model calls must still pass the Workspace's gateway (`CONTEXT.md`, Gateway), so e2b would need a tunnel back to the instance; code leaves the instance | Poor: replaces the Runner and Claude Agent SDK loop; model calls go to Anthropic with an Anthropic key, bypassing the gateway, budgets and non-Anthropic tiers; self-hosted sandbox variant keeps tools on own hosts but still sends history and tool results to Anthropic ([choosing an environment](https://platform.claude.com/docs/en/managed-agents/choosing-an-environment)) | Poor for runs that must heartbeat and stream to the instance; fine for CI-style proof |

Reading: A is the cheapest real improvement and closes the same-user hole. B is the right shape once untrusted tenants share a host. C, D, E, F each add a vendor or an orchestrator without removing the need for the policy in section 5. E and D also conflict with the self-hosted and air-gapped posture of `compose.yaml` (`BAUHERR_PRICES_REFRESH=0` for air-gapped installs).

Claude sandbox facts that shape A ([sandboxing](https://code.claude.com/docs/en/sandboxing)): it wraps Bash only, off by default, `failIfUnavailable` defaults to false so a missing dependency silently means unsandboxed, Linux needs `bubblewrap` and `socat`, reads default to the whole machine unless `filesystem.denyRead` is set, and in an unprivileged container bubblewrap needs `enableWeakerNestedSandbox`, which exposes container process info. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` strips credentials from subprocess environments. So bubblewrap alone does not stop the Read tool or `/proc` of the same user; the separate user does.

## 5. Policy model

A Product configures one policy; the Runner enforces it; the same object applies to agent Bash and to proof commands.

| Field | Default | Meaning |
|---|---|---|
| `network.presets` | none | Opt-in sets: `npm`, `pypi`, `crates`, `go`, `maven`, `rubygems` (host lists kept in code) |
| `network.hosts` | empty | Extra exact hosts or `*.` wildcards, for example the staging URL host |
| `limits.turns / usd / minutes` | 80 / 5 / 25 | May be lowered per Product, raised only by an Admin |
| `forge.role` | build: push own branch and open a pull request; verify, review, intake, brief: read | Token minted per run for one repository with the role's permissions (the GitHub App token API accepts `repositories[]` and `permissions`, `docs/research/github-driver.md` line 33) |
| `secrets` | never in the run env or on the run's disk | Gateway key and forge token stay in the Runner; a Product's own secrets (test account) reach a run only through a named, per-Product, read-once file mounted for Verify or Intake reproduction |
| `write.paths` | whole checkout except `.git`; Intake and Brief only `.bauherr/` | Existing `writeScopeGuard`; add Product-declared protected paths (CI config, workflows) refused at seal time, as the research doc proposed |
| `executor` | `session` | Unchanged; `runner` requires branch protection on |

Defaults are strict, the Bauherr relaxes per Product. The Settings page shows the effective policy next to the executor choice, as it shows readiness today.

## 6. Live bug reproduction at Intake

**What it means.** For a bug report with steps, a run starts the Product's staging, follows the reporter's steps in a browser, and records either a failing test or a screenshot plus console log. The Intake result gains a `reproduction` field: `reproduced`, `not reproduced`, or `not attempted` with the evidence. The Bauherr's Question card then shows evidence instead of a reporter round (`CAPS.reporterRounds = 2`).

**What exists.** A Product has a `stagingUrl` text field (`apps/server/src/collections/products.ts:45`) and a staging version check (`core/deploy.ts`). Intake is read-only (`jobs/runner/work.ts:21`). There is no browser in the image (`Dockerfile`) and no screenshot proof for the Runner: Runner proofs are `command`, `text` or `url` (`proofs.ts:22-41`); screenshots come only through `attach_proof` upload from sessions (`pack/skills/verify.md:10-14`). Releases are not built yet (`CONTEXT.md`, Planned), so "the version the reporter saw" is not a fact the factory has; staging may be newer or older than the report.

**What it needs.**

1. A sandbox with a browser (Playwright image) and a network allowlist of exactly the staging host plus the gateway.
2. A test account for staging, stored as a Product secret and handed over as in section 5.
3. A Runner proof kind for screenshots, with the file stored like other proof uploads.
4. A rule on staleness: record the staging version at the time and say so in the result when it differs from the issue date.
5. Prompt-injection stance: the page under test is untrusted input as much as the issue text; with a host allowlist and no secrets in the run, the worst case is a wrong verdict, which is why it is labelled evidence for the Bauherr and never decides alone.

**Cost per Intake (estimate, not measured).** Sandbox time of 5-10 minutes is about $0.01-0.03 on a hosted sandbox at the e2b rate above and nothing extra on the own host. Tokens dominate: Intake today is a cheap-tier read-only run; a browser loop adds screenshots as image input and a larger tool schema, plausibly $0.30-1.50 at standard tier. Treat these as hypotheses; measure on three real issues in PR 3 before switching it on.

**When it runs.** Only if all hold: the Product opted in, the issue is typed as a bug, the report contains steps or a URL, `stagingUrl` is set and healthy, and the Workspace budget has room. Once per ticket, again only after a reporter answers. Never on `observing` Products during First look (the forge writer refuses there and cost would multiply over the whole backlog).

## 7. Smallest first PR (the recommendation)

Title: `feat(runner): Run the agent as an unprivileged user inside the Claude sandbox`

- Image: install `bubblewrap` and `socat`; add an `agent` user; start the worker as root only long enough to spawn the SDK child as that user with `spawnClaudeCodeProcess` (`uid`, `gid`), then keep the worker's files unreadable to it.
- `buildOptions`: `sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false }`, `network.allowedDomains` empty, `filesystem.denyRead` for `/run/secrets` and the worker's paths, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`.
- `proofs.ts` `run`: execute proof commands through the same wrapper instead of bare `sh -c`.
- `compose.yaml` worker: `cap_drop: [ALL]` (add only what the uid split needs), `no-new-privileges`, `mem_limit`, `pids_limit`, size-capped tmpfs for the run directory.
- Test: a run (stub gateway, as in `packages/runner/test`) that tries `cat /run/secrets/encryption_key`, reads `/proc/1/environ` and opens a socket with `node -e` must fail; the run still completes a normal edit and commit.
- Open point to settle inside the PR: whether bubblewrap works in the unprivileged worker container or needs `enableWeakerNestedSandbox`; the research doc marks the uid split "unverified: needs a root-started container".

Later PRs, in order: (2) policy object and Settings display, registry presets, branch protection as blocker; (3) screenshot proof and opt-in Intake reproduction; (4) per-run gateway key; (5) container per run with gVisor behind the same `AgentRequest` seam, when a customer needs it.

## 8. Sources

- Claude Code, secure deployment: https://code.claude.com/docs/en/agent-sdk/secure-deployment
- Claude Code, sandboxing: https://code.claude.com/docs/en/sandboxing
- Claude Managed Agents: https://platform.claude.com/docs/en/managed-agents/overview, https://platform.claude.com/docs/en/managed-agents/environments, https://platform.claude.com/docs/en/managed-agents/choosing-an-environment, pricing https://platform.claude.com/docs/en/about-claude/pricing
- e2b: https://docs.e2b.dev/docs/sandbox, https://docs.e2b.dev/sandbox/internet-access, https://e2b.dev/pricing
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- In repo: `docs/research/runner-execution-model.md`, `docs/research/github-driver.md`, `docs/gateway.md`
