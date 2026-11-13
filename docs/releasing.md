# Releasing

One git tag publishes everything. From `main`:

```bash
git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1
```

[`release.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/release.yml) (environment `release`, tag must be on `main`) first pushes the multi-arch image `ghcr.io/getbauherr/bauherr:<version>` (`latest` only for versions without a `-pre` suffix), then stages npm `bauherr@<version>` from `packages/cli` with provenance via trusted publishing (`npm stage publish`; no token stored, so setup-node has no `registry-url` (it would write a token placeholder into `.npmrc` and break OIDC; `NODE_AUTH_TOKEN` is unset before publish); the npm package settings name this repository and workflow and allow staged publishing only). Pre-releases get the npm tag `next`. A maintainer approves the staged version (`npm stage approve <stage-id>` or on npmjs.com) to make it installable. The CLI pins the image tag to its own version.

## Staging

[`staging.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/staging.yml) runs on every push to `main` (one run per sha). It builds the image, starts it once against a throw-away Postgres (it migrates on start, like `compose.yaml`) and requires `GET /api/health` to return `{"ok":true}`. It then pushes `ghcr.io/getbauherr/bauherr:sha-<sha>` (multi-arch), moves `:staging` to it only when the sha is newer than the current `:staging`, and always reports the check `staging` on that sha. There is no hosted staging site: `:staging` is the staging.

Run it locally with `BAUHERR_VERSION=staging docker compose up -d` (compose.yaml's image is `ghcr.io/getbauherr/bauherr:${BAUHERR_VERSION:-dev}`).

To let merged Tickets move to "on staging" by themselves, an Admin sets the bauherr Product's Deploy tab once: deploy mode "checks", deploy checks `staging`, staging site empty. The setting lives in the factory database, not in this repository.
