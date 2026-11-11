# bauherr

One-command start for the [Bauherr](https://github.com/getbauherr/bauherr) AI software factory. Needs Docker with Compose and Node 22.14+.

```bash
npx bauherr init [--dir bauherr] [--port 3000] [--url http://localhost:3000] [--yes]
npx bauherr up | down [--volumes] | status | seed
BAUHERR_API_KEY=<personal key> npx bauherr apply -f factory.yaml --workspace <slug> [--dry-run] [--url <instance>]
BAUHERR_API_KEY=<personal key> npx bauherr export --workspace <slug> [--out factory.yaml]
npx bauherr pack lint [--pack pack] [--context CONTEXT.md] [--spec docs/spec/workflow.md]
```

`init` writes `compose.yaml` (image pinned to this CLI's version) and a mode-600 env file with generated secrets, starts the stack and opens the UI. Re-running it keeps the secrets. `apply` sends a factory file to a Workspace (an Admin's personal key; `profile_file`s are inlined relative to the file; exit code 1 on findings), `export` prints the active one. `pack lint` checks a pack directory (size caps, cited paths, glossary *Avoid* terms, role tiers against the spec table, stack names outside `stacks/`, hook citations), prints `file:line: sentence` per finding and exits 1 on any; see [pack/README.md](../../pack/README.md#lint). Docs: https://github.com/getbauherr/bauherr#quick-start
