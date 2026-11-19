# bauherr

One-command start for the [Bauherr](https://github.com/getbauherr/bauherr) AI software factory. Needs Docker with Compose and Node 22.14+.

```bash
npx bauherr init [--dir bauherr] [--port 3000] [--gateway-port 4000] [--url http://localhost:3000] [--yes]
npx bauherr up | down [--volumes] | status | seed
npx bauherr pack lint [--pack pack] [--context CONTEXT.md]
```

`init` writes `compose.yaml` (image pinned to this CLI's version) and a mode-600 env file with generated secrets, starts the stack and opens the UI. Re-running it keeps the secrets. `pack lint` checks a pack directory (size caps, cited paths, glossary *Avoid* terms, stack names outside `stacks/`), prints `file:line: sentence` per finding and exits 1 on any. Docs: https://github.com/getbauherr/bauherr#quick-start
