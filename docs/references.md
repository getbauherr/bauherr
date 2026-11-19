# Credits and references

Bauherr keeps its rules in tools, not in prose. This page credits the outside sources the rules come from and points at the file that checks each one. A practice is listed only when a file in this repository enforces or states it today.

| Source | What Bauherr takes from it | Enforced by |
|---|---|---|
| Lauren Tan, talk [All Code Is Slop (Except Mine)](https://www.youtube.com/watch?v=O_zcc6Xl12g), AI Engineer Code Summit, 2026-11-11 | Put a rule into code or a check before prose. Ban comments. Directories are import boundaries. A lint message names the fix. Clean up what an agent could copy. | `eslint.config.mjs`, `apps/server/tests/no-comments.test.ts`, `apps/server/tests/lint-rules.test.ts`, `eslint-suppressions.json`, `AGENTS.md` |
| Lauren Tan, [pstack](https://github.com/cursor/plugins/tree/main/pstack) | A comment allowlist. A disable directive needs a reason. | `pack/rules/no-comments.md`, `apps/server/tests/no-comments.test.ts` |
| Addy Osmani, [Agentic Code Quality](https://addyosmani.com/blog/agentic-code-quality/) | Size and complexity limits enforced by lint. | `eslint.config.mjs` |
| Addy Osmani, [Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/) | A short agents file. Hooks that are silent on success. | `AGENTS.md`, `apps/server/tests/repo-files.test.ts`, `.githooks/` |
| Addy Osmani, [Brownfield Agentic Engineering](https://addyosmani.com/blog/brownfield-agentic-engineering/) | Write down only what the code cannot say. Move a rule into a lint rule, hook, type or test. | `apps/server/tests/repo-files.test.ts`, `eslint.config.mjs` |
| Addy Osmani, [Long-running Agents](https://addyosmani.com/blog/long-running-agents/) | Tests are not skipped or parked. Typecheck and lint run as hooks. | `eslint.config.mjs`, `.githooks/` |
| Addy Osmani, [Software Factories, Light and Dark](https://addyosmani.com/blog/software-factories/) | Types catch mistakes before review. | `apps/server/tsconfig.core.json` |
| firsttris, [haben](https://github.com/firsttris/haben) | One place per rule. A limit on function length. | `AGENTS.md`, `eslint.config.mjs` |
| storytold, [autocraft](https://github.com/storytold/autocraft) | One module writes to the forge, and a check enforces it. | `eslint.config.mjs` |
| Matt Pocock, [skills](https://github.com/mattpocock/skills) | A mechanical mistake becomes a deterministic check. Ask in one round with a recommended answer. | `eslint.config.mjs`, `AGENTS.md` |
| storytold, [craft-anything](https://github.com/storytold/craft-anything) | End a turn with a handoff written for a stranger. | `AGENTS.md` |
| Anthropic, Claude Code [Code Review](https://code.claude.com/docs/en/code-review.md) | A review skips what CI already enforces. | `REVIEW.md` |
