# Credits and references

Bauherr collects agent-development practice from these people. Each entry has an id (a skill or rule can cite it in its `sources` frontmatter), the author, the title, the link, and one line on what it shaped in Bauherr.

| id | Author | Title | URL | Shaped in Bauherr |
|---|---|---|---|---|
| `tan-2026` | Lauren Tan | "All Code Is Slop (Except Mine)", AI Engineer Code Summit 2026 | [ai.engineer](https://ai.engineer/talks/O_zcc6Xl12g-all-code-is-slop-except-mine), [YouTube](https://www.youtube.com/watch?v=O_zcc6Xl12g) | Trust pyramid, comment ban, every correction becomes a check, feature map, proof-based review |
| `pstack` | poteto | pstack plugin | [github.com/cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack) | Verify skill per Product (launch, doctor, drive, evidence, cleanup), feature map fields reach, drive and gotchas, `/correct` order of fixes, comment allowlist, blast radius |
| `osmani-factories` | Addy Osmani | Software Factories, Light and Dark | [addyosmani.com](https://addyosmani.com/blog/software-factories/) | The factory framing: autonomy bounded by explicit gates and humans at the checkpoints |
| `osmani-judgment` | Addy Osmani | Human judgment doesn't leave the software factory. It relocates. | [addyosmani.com](https://addyosmani.com/blog/human-judgment-doesnt-leave-the-software/) | Risk zones: judgment moves to plans, proofs and acceptance instead of line-by-line review |
| `osmani-review` | Addy Osmani | Agentic Code Review | [addyosmani.com](https://addyosmani.com/blog/agentic-code-review/) | Evidence packets on every merge request, maker/checker split between build and review |
| `osmani-quality` | Addy Osmani | Agentic Code Quality | [addyosmani.com](https://addyosmani.com/blog/agentic-code-quality/) | Verification budget per change and the fake-green guard against checks that pass without proving anything |
| `osmani-loops` | Addy Osmani | Practical Loop Engineering | [addyosmani.com](https://addyosmani.com/blog/practical-loop-engineering/) | Run outcomes that route Tickets, bounded retries and review rounds |
| `osmani-orchestration-tax` | Addy Osmani | The Orchestration Tax | [addyosmani.com](https://addyosmani.com/blog/orchestration-tax/) | Fleet sized to the review rate, WIP limits per stage |
| `osmani-long-running` | Addy Osmani | Long-running Agents | [addyosmani.com](https://addyosmani.com/blog/long-running-agents/) | Worklog, leases and heartbeats so a Run survives a dead session |
| `osmani-harness` | Addy Osmani | Agent Harness Engineering | [addyosmani.com](https://addyosmani.com/blog/agent-harness-engineering/) | The pack (skills, rules, hooks) as the harness every Run starts with |
| `osmani-skills` | Addy Osmani | Agent Skills | [addyosmani.com](https://addyosmani.com/blog/agent-skills/) | Skills as small, cited, linted files with an eval |
| `osmani-autonomy` | Addy Osmani | Agentic Autonomy Levels | [addyosmani.com](https://addyosmani.com/blog/agentic-autonomy-levels/) | Run mode per stage and the human checkpoints as a level the owner chooses |
| `osmani-brownfield` | Addy Osmani | Brownfield Agentic Engineering | [addyosmani.com](https://addyosmani.com/blog/brownfield-agentic-engineering/) | Knowledge repo and path sets so agents learn an existing codebase |
| `osmani-intent` | Addy Osmani | The Intent Debt | [addyosmani.com](https://addyosmani.com/blog/intent-debt/) | Plans with a TL;DR and acceptance criteria that keep intent written down, trust metrics in Insights |
| `anthropic-code-review` | Anthropic | Claude Code Review | [code-review](https://code.claude.com/docs/en/code-review.md), [customize](https://code.claude.com/docs/en/code-review-customize) | Find, verify, rank, post review pipeline; Important, Nit and Pre-existing findings; `REVIEW.md` read from the base branch |
