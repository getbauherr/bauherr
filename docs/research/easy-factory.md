# An easy software factory for every developer

Research note, 2026-11-11. Written as a proposal; the "Has" lines and section 9 record what Bauherr shipped from it the same week. Sources are numbered `S1`..`S26` and listed at the end; every
claim about another product cites one. `not verified` = the page I opened did not say it, or I did not open a page.
Repo facts: `README.md`, `docs/ui.md`, `docs/session-mode.md`, `pack/factory.yaml`, `pack/roles/`.

## 1. Answer first

- Developer: a first useful result in one sitting. Connect a repo, assign one existing issue, get a pull request with
  evidence. Config that matters lives in the repo as files (Cursor `environment.json` S15, Factory droids S1,
  Copilot `.agent.md` S9, Claude subagents S17).
- Developer: always see what the agent is doing and since when. Linear, Devin, Cursor and Claude all show a live
  session (S4, S12, S14, S18).
- Developer: a human stays owner. Linear delegation keeps the human as assignee (S12); Factory caps autonomy per
  org (S2); Copilot holds back Actions runs until a human approves (S8).
- Product owner: files an issue in the tool they already use and never has to open the factory. Progress comes back
  as comments and a status on that issue (Factory S3, Devin S5, Linear S11).
- Product owner: hears only when needed. A question for them, something to accept, done. Not every step.
- Both: one place that says what waits for me. Bauherr has this (Inbox); the compared tools mostly have a session list.
- Setup is short when it asks for nothing it can detect and defers the rest (Vercel S23, Cursor S15).
- Gap when this was written: roles and gates were only in `factory.yaml`, not a choice at setup, and `/setup` asked
  for deploy config before the first request. Both are closed (section 9).

## 2. Comparison

| Tool | Setup | Assign work | Roles | Human approval | Visibility | Progress for non-devs | Config as code | Metrics | Src |
|---|---|---|---|---|---|---|---|---|---|
| Factory Droids | Admin connects Linear in Settings, Delegations | Assign Linear issue or @Factory | Custom droids: Markdown, model and tools | Autonomy Off to High; org maximum | Progress in agent session on issue | PR URL attached to issue | `.factory/droids/` in repo | not verified | S1 S2 S3 |
| Devin | Sign up; connect Linear, pick teams | Slack/Teams tag, Linear assign, web, CLI | Playbooks: org, enterprise, system scope | No formal gate described; steer or stop | Live shell, IDE, browser | Activity feed and todo list in Linear | Playbooks in Settings UI; repo files not verified | not verified | S4 S5 S6 |
| Copilot coding agent | Assign issue; optional prompt, branch, agent, model | Assign issue, from list or Projects | Custom agents: `.agent.md`, repo, org, enterprise | Actions need "Approve and run"; review requested | Session logs; Agents tab and panel | Session logs and PR open to repo members | `.github/agents`, instructions, MCP, hooks | Org PR creation, merges, time to merge | S7 S8 S9 |
| GitHub Agent HQ | not verified | Pick agents, assign in parallel | not verified | Branch controls decide when CI runs | Mission control: progress of all agents | not verified | not verified | Copilot metrics dashboard (preview) | S10 |
| Linear agents | Admin installs, chooses teams | Delegate by assigning, or @mention | Agent is an app user; workspace and team guidance | Not described; human stays owner (delegate) | Agent session with typed activities | Delegated issues stay in My issues | Guidance text in settings; repo files not verified | Insights split by Delegate | S11 S12 S13 |
| Cursor cloud agents | Admin connects forge; guided env setup, under 10 min claimed | Desktop, web, mobile, Slack, GitHub, Linear, API | not verified | Merge-ready PR on branch; spend limit asked first | Conversation, diffs, screenshots; take over desktop | Team members view read-only | `.cursor/environment.json`, `hooks.json` | not verified | S14 S15 |
| Codex cloud | Sign in to ChatGPT; pick environment or repo | Start chat in Cloud; Slack, Linear listed | not verified | Inspect diff, request changes, then PR | Own workspace per task; detail not described | not verified | Published environment reusable; AGENTS.md not verified | not verified | S16 |
| Claude Code | Connect GitHub; Default environment created | Browser, mobile, desktop, `--cloud`, scheduled | Subagents: Markdown; agent teams experimental | Permission modes; plan mode; inline diff comments | Teammate panel and transcripts; Changes card | Team visibility; Slack sessions shared | `.claude/agents/`, managed settings | PRs with Claude, adoption, spend | S17 S18 S19 S20 |
| CrewAI | not verified | not applicable (library) | `role`, `goal`, `backstory` per agent | Human input not verified | not verified | not applicable | `agents/<name>.jsonc` or `agents.yaml` | not verified | S21 |
| Vibe Kanban | `npx vibe-kanban` after agent login | Kanban issue, start workspace with agent | 10+ agents selectable; roles not verified | Review diffs, comment inline, merge | Branch, terminal, dev server per workspace | Private or team kanban issues | not verified | not verified | S22 |

Vibe Kanban's README says it is sunsetting (S22). I chose it as the open-source board for its issue-to-workspace
model, not as a dependency.

## 3. Patterns worth adopting

1. **Delegate, do not reassign.** Who: Linear keeps the human as assignee and sets the agent as delegate (S12).
   Bauherr: show "Delegate: engineer role" on the ticket next to the human owner, never replace the owner. Has:
   partly. A claimed Ticket gets `githubLogin` as assignee; the Ticket names the session and its role as who works on
   it (`docs/session-mode.md`). No separate delegate field.
2. **Typed activity feed per agent session.** Who: Linear (thought, action, elicitation, response, error; S12).
   Bauherr: Steps already record what a Run did. Has: yes, Run page timeline and Ticket "Steps" (`docs/ui.md`).
3. **Roles as files in the repo.** Who: Factory S1, Copilot S9, Claude S17; project beats personal on a name clash
   (S1, S17). Bauherr: `profile_file` per role exists in `pack/roles/`. Add a product-repo override directory, and have
   the setup picker write these files. Has: yes. Six role files ship
   (`orchestrator`, `engineer`, `reviewer`, `security`, `ux`, `test`); the Team page and the setup presets write the
   Workspace's factory file. Not yet: a product-repo override directory.
4. **Autonomy as one ladder with an org cap.** Who: Factory (Off, Low, Medium, High; Maximum Autonomy Level; S2).
   Bauherr: name three presets that set `gate: human` on `plan`, `release`, `production_gate`. Has: yes. Setup offers
   Solo, Standard and Careful; each is a factory file in `pack/presets/`. No Workspace-wide cap.
5. **Admin connects once and chooses the scope.** Who: Linear S11, Devin S5 (choose teams), Cursor S14. Bauherr:
   the connect step stays one Connection, then Products picked from a list. Has: yes (`/setup` step 1, Product form).
6. **Environment set up by the agent, committed as a file.** Who: Cursor (agent-led setup, commit
   `environment.json`; S15). Bauherr: let the first Build Run propose `productionChecks` and staging URL as a PR.
   Has: no. Today the owner fills the Staging, Approvals and Production sections.
7. **Take over a running session.** Who: Cursor (remote desktop, S14), Claude (`--teleport`, S19), Devin (S4).
   Bauherr: connected sessions are the take-over path. Has: yes (session mode, agent keys on `/settings/api-key`).
8. **One list of every agent's work.** Who: Agent HQ mission control (S10), Copilot Agents tab (S8). Bauherr: Workflow
   graph home plus `/runs`. Has: yes. The Team page lists every session and Runner with its ticket and active time; stage cards on the Workflow
   show who is stationed there.
9. **Decision cards that tell you what to do.** Who: Copilot requests review when done (S8). Bauherr: Inbox with TL;DR
   cards by checkpoint. Has: yes (`/inbox`).
10. **Request types that pick the skill.** Who: Devin skill labels such as `@skills:implement` and a default skill (S5);
    macros (S6). Bauherr: intake offers Bug, Feature, Chore; each maps to a skill and role. Has: no. Intake is
    one chat (`IntakeChat`).
11. **Metrics split by agent.** Who: Linear Insights by Delegate (S11), Claude PRs with Claude and adoption (S20),
    Copilot time to merge (S7). Bauherr: Insights has a Team section with active time per role and session. Has: partly. Cost per role is
    not shown.
12. **Layered guidance, team over workspace.** Who: Linear (team guidance wins; S11). Bauherr: Workspace Knowledge, a
    Product's `repo-docs` layer on top. Has: yes (`/knowledge`).

## 4. Patterns to avoid

- **Persona fiction in role files.** CrewAI defines agents by `role`, `goal`, `backstory` (S21). A backstory adds
  tokens and no contract. Judgement, not sourced. Character cards in the picker are fine; the file behind a card
  states duties, tools, tier and gates.
- **Agent teams that talk to each other by default.** Claude's version is experimental, costs more tokens, allows one
  team per session and does not resume (S18). Bauherr's stages already hand over by Ticket.
- **Setup that needs infrastructure before the first result.** Cursor needs a built environment first (S15). Bauherr's
  old `/setup` step 3 did the same for staging. It moved behind the first release gate.
- **Config only in a UI.** Devin playbooks are created in Settings (S6); a repo-file path is not verified. UI-only
  config cannot be reviewed in a PR.
- **Depending on a sunsetting project.** Vibe Kanban (S22).
- **Autonomy that is high by default.** Factory missions need High autonomy or an unsafe flag (S2). Keep Approve
  production on by default, as `pack/factory.yaml` does.

## 5. Settings and onboarding recommendation

Scopes follow the common three: personal, organisation, repository. GitHub splits personal account and organisation
settings, and an organisation's settings are owner-only (S24, S25). Linear splits workspace and team (S13). Bauherr
maps them to Account, Workspace and Product. "Factory" is new and holds what the factory does. Linear's Account page
holds profile, preferences, notifications (search snippet only; S26, not verified on the page).

The tree as proposed; the right column is the state before the rework. The shipped map is in `docs/ui.md`
(Settings): Models & budget and Knowledge ended up as their own pages, and there is no Notifications page yet.

```text
Account            every user, own record only
  Profile          name, language, githubLogin            (now: user menu)
  Notifications    what reaches me, by email or forge     (new)
  Agent keys       claude mcp add line                    (now: /settings/api-key)
Factory            Admin
  Team             role cards, tier per role              (new; now factory.yaml)
  Workflow         gates and modes per stage              (now: /settings/workflow)
  Templates        text templates                         (now: /settings/templates)
  Knowledge        repo, documents                        (now: /settings/workspace)
Workspace          Admin edits, Bauherr reads
  Products         repo, ticket source, staging, production checks   (now: /settings/products)
  Connections      forge, LLM provider                    (now: /settings/connections)
  Members          Bauherren and roles                    (now: /settings/bauherren)
  Budget           amount, unit, model tiers              (now: /settings/workspace)
Admin              instance-wide health
  Usage and cost   spend, tokens                          (now: /settings/usage)
  Audit            touches, tool calls                    (now: /settings/audit)
  Factory health   jobs, polls, gateway                   (now: block on /settings/workspace)
  Feedback         chat ratings                           (now: /settings/chat-feedback)
```

### Setup wizard, 5 steps

Steps and Done rules reuse `/setup`: Done is computed from data, a reload resumes (`docs/ui.md`). Vercel's flow is
connect, select repo, Deploy, with the framework detected (S23). Cursor's agent-led setup is about five steps, under
10 minutes by its own claim (S15).

| # | Step | Asks | Default | Skip |
|---|---|---|---|---|
| 1 | Connect forge | GitHub token, then Verify | verified GitHub Connection (S14, S19: connect source control first) | no, required |
| 2 | Product | repository from a list | name = repo name, ticket source = its issues (S23: pick repo, then deploy) | never |
| 3 | Pick your team | one of three presets, then role cards | "Standard": orchestrator, engineer, reviewer; Approve production on | yes, takes the default |
| 4 | Connect sessions | nothing, or create an agent key | skip: autonomous runner (`docs/session-mode.md`) | yes |
| 5 | First request | pick an open issue, or write one | an existing open issue (S3, S8: work starts from an issue) | no; Done = a Ticket exists |

Presets, sketch:

- Solo: engineer only; plans pass without approval.
- Standard: orchestrator, engineer, reviewer; Approve plan on, Approve production on (the owner's decided default).
- Careful: adds staging acceptance and a security review stage worked by the security role.

Staging URL, deploy checks and production approval leave the wizard. The "Configure production checks" gate already
asks for them when a Ticket first reaches release (`README.md`). Factory ties its autonomy preset to a level and a
cap (S2), which is the model for the preset-to-gates mapping.

## 6. Product-owner view

The owner files an issue in GitHub or in the Requests page. They should see, in plain words, on the issue itself:

- "Received. The factory is reading it." (Triage)
- "Questions for you." Links to the answer form. This is the only step that waits for them before work starts.
- "Being built." One line, no stage names. Replace "plan" and "build" with "planning" and "building".
- "Ready to try on staging", with the staging link and Accept or Request changes.
- "Released" or "Closed", with what changed.
- "Stuck", with the reason in a sentence, and who looks at it.

Notify by email or forge comment on: a question, ready to accept, released, stuck. Do not notify on Runs, retries or
review rounds.

Grounding: Factory posts progress in its agent session on the issue and attaches the PR URL (S3). Devin syncs its
activity feed and todo list into Linear (S5). Linear keeps delegated issues in the owner's My issues (S11). Copilot
requests a review, which notifies (S8). Cursor lets team members view an agent read-only, and follow-ups need an
admin to enable them (S14). Claude shares sessions with Team visibility (S19).

Bauherr has `/requests/[id]` with the progress path and "What happens next", and one plain-word progress Comment on
the issue, edited in place, with a new Comment only for a question, ready on staging, released and stuck
(`docs/spec/workflow.md`). Missing: per-person notification settings.

## 7. Open questions (answered in section 8)

1. Does a product owner get a Bauherr login, or is the forge issue plus email enough?
2. Three named presets, or free role picking with the preset as a shortcut? Do the cards get names beyond the role
   title?
3. Move staging and production config out of `/setup` and into the first release gate, as proposed?
4. Default notification channel: email, forge comment, or both?
5. May a product owner see cost and time per role, or is that Admin only?

## 8. Decisions on the open questions

1. No login needed: the forge issue carries the progress. People with a login also get the Requests pages.
2. Three presets as shortcuts; roles stay freely editable in the factory file and on the Team page.
3. Yes. Staging and production config left the wizard; the "Configure production checks" gate asks at first release.
4. Forge comment only. No email.
5. Admin only.

## 9. What Bauherr adopted

| Pattern | Where it is |
|---|---|
| Roles as files, picked at setup | `pack/roles/`, `pack/presets/`, `/setup` step 3, `/team` |
| Sessions with live presence | MCP `connect` and `next_work`; Team page; stage cards on the Workflow |
| One place for what waits for me | Inbox with prepared decision cards |
| Autonomy as named presets | Solo, Standard, Careful |
| Progress for non-developers on the issue | Progress Comment, Requests path, editable `progress` template |
| Settings by scope | Account, Factory, Workspace, Admin; Product page in tabs |
| Short setup that defers infrastructure | Five steps; deploy config asked at first release |
| Config as code | One `factory.yaml` per Workspace: apply, version, export |
| Metrics split by agent | Insights Team section |

Not adopted yet: request types that pick a skill (pattern 10), an agent that proposes the deploy config as a PR
(pattern 6), a Workspace-wide autonomy cap, per-person notification settings.

## 10. Sources

All accessed 2026-11-11.

- S1 https://docs.factory.com/cli/configuration/custom-droids (redirected from docs.factory.ai)
- S2 https://docs.factory.com/autonomy-and-safety/auto-run
- S3 https://docs.factory.com/onboarding/integrating-with-your-engineering-system/linear
- S4 https://docs.devin.ai/get-started/devin-intro
- S5 https://docs.devin.ai/integrations/linear
- S6 https://docs.devin.ai/product-guides/using-playbooks
- S7 https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- S8 https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github
- S9 https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-custom-agents
- S10 https://github.blog/news-insights/company-news/welcome-home-agents/
- S11 https://linear.app/docs/agents-in-linear
- S12 https://linear.app/developers/agents
- S13 https://linear.app/docs/teams
- S14 https://cursor.com/docs/cloud-agent
- S15 https://cursor.com/docs/cloud-agent/setup
- S16 https://learn.chatgpt.com/docs/cloud (redirected from developers.openai.com/codex/cloud)
- S17 https://code.claude.com/docs/en/sub-agents
- S18 https://code.claude.com/docs/en/agent-teams
- S19 https://code.claude.com/docs/en/claude-code-on-the-web
- S20 https://code.claude.com/docs/en/analytics
- S21 https://docs.crewai.com/en/concepts/agents
- S22 https://github.com/BloopAI/vibe-kanban
- S23 https://vercel.com/docs/getting-started-with-vercel
- S24 https://docs.github.com/en/organizations/managing-organization-settings
- S25 https://docs.github.com/en/account-and-profile/concepts/account-management
- S26 https://linear.app/docs/workspaces, https://linear.app/docs/profile (named in a search result; pages not opened)

Opened but not cited: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-a-pr.
Not opened, not cited: OpenHands, Devin GitHub integration, Factory analytics, GitHub "Types of GitHub accounts".
