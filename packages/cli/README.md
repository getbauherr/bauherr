# bauherr

One-command start for the [Bauherr](https://github.com/getbauherr/bauherr) AI software factory. Needs Docker with Compose and Node 22.14+.

```bash
npx bauherr init [--dir bauherr] [--port 3000] [--url http://localhost:3000] [--yes]
npx bauherr up | down [--volumes] | status | seed
```

`init` writes `compose.yaml` (image pinned to this CLI's version) and a mode-600 env file with generated secrets, starts the stack and opens the UI. Re-running it keeps the secrets. Docs: https://github.com/getbauherr/bauherr#quick-start
