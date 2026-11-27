# Runner isolation

An agent run executes code from your repository. The Runner keeps each run apart from the others and from the secrets of the worker.

## What a run gets

- **Its own user**: each concurrent run uses one of 32 system users. Its directory is private to that user. Leftover processes of the user are killed after every turn and at cleanup.
- **A short environment**: the agent sees only `PATH`, `HOME`, `TMPDIR`, `LANG` and the gateway address. It does not see the worker's environment or `/run/secrets`.
- **No forge token in git**: the token is handed to `clone`, `fetch` and `push` only. Git's configuration is restored from the clone before each call, and hooks, helpers and global configuration are switched off.
- **No network tools**: the agent cannot use `curl`, `wget`, `ssh`, `git push` or the web tools.

## What your compose must set

The worker starts as root only to hand work to the run users. Keep these settings on the `worker` service, as in the shipped `compose.yaml`.

```yaml
read_only: true
tmpfs: ["/tmp:exec,nosuid,mode=1777,size=4g", "/root:mode=0700,size=256m"]
cap_drop: [ALL]
cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]
security_opt: ["no-new-privileges:true"]
```

The secrets and gateway volumes must be readable by root only. The `init` service sets that.

## Limits

- At most 32 runs at once per worker. `BAUHERR_MAX_RUNS` above 32 fails the claim with an error.
- Run one worker process per container. The pool of users belongs to the process.
