# Releasing

Images exist only for versions. Merges to `main` publish no image; a version goes out in two manual steps from `main`, with a test on your own deployment in between.

```bash
gh workflow run cut-rc.yml -f bump=minor     # patch | minor | major; tags vX.Y.Z-rc.N, publishes :X.Y.Z-rc.N
# on your own instance: pin the RC, test it
BAUHERR_VERSION=X.Y.Z-rc.N docker compose pull app && BAUHERR_VERSION=X.Y.Z-rc.N docker compose up -d
gh workflow run promote.yml                  # tags vX.Y.Z on the RC's commit, publishes :X.Y.Z and :latest
```

[`cut-rc.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/cut-rc.yml) computes the next version from the `v*` tags: if an unpromoted RC line for the target exists it is `rc.N+1`, else the latest final tag is bumped and it starts at `rc.1`. It tags `main` HEAD, starts `release.yml` for the tag and creates (or updates) the draft GitHub Release `vX.Y.Z` with generated notes since the last final tag. A fix after a bad RC: merge it, cut again (`rc.N+1`).

[`promote.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/promote.yml) takes an RC tag (default the newest). It refuses unless the tag is an RC, the newest RC of its `X.Y.Z`, and `vX.Y.Z` does not exist. It tags `vX.Y.Z` on the same commit and starts `release.yml`, which rebuilds from that commit and, when image and npm are done, publishes the draft GitHub Release as the latest release.

Both workflows start `release.yml` themselves (`gh workflow run --ref <tag>`), because a tag pushed with `GITHUB_TOKEN` triggers no workflow. A tag pushed by hand triggers it too.

[`release.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/release.yml) (environment `release`, tag must be on `main`) first pushes the multi-arch image `ghcr.io/getbauherr/bauherr:<version>` (`latest` only for versions without a `-pre` suffix), then stages npm `bauherr@<version>` from `packages/cli` with provenance via trusted publishing (`npm stage publish`; no token stored, so setup-node has no `registry-url` (it would write a token placeholder into `.npmrc` and break OIDC; `NODE_AUTH_TOKEN` is unset before publish); the npm package settings name this repository and `release.yml` and allow staged publishing only). Pre-releases get the npm tag `next`. A maintainer approves the staged version (`npm stage approve <stage-id>` or on npmjs.com) to make it installable. The CLI pins the image tag to its own version.

## Staging and production checks

[`staging.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/staging.yml) runs on every push to `main` (one run per sha). It builds the image, starts it once against a throw-away Postgres (it migrates on start, like `compose.yaml`) and requires `GET /api/health` to return `{"ok":true}`, then reports the check `staging` on that sha. It pushes no image. [`production.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/production.yml) reports the check `production` on a Ticket's merge sha after the owner's approval; the change ships with the next release.

Run any version locally with `BAUHERR_VERSION=<version> docker compose up -d` (compose.yaml's image is `ghcr.io/getbauherr/bauherr:${BAUHERR_VERSION:-dev}`); a checkout builds its own `dev` image.

To let merged Tickets move to "on staging" by themselves, an Admin sets the bauherr Product's Deploy tab once: deploy mode "checks", deploy checks `staging`, staging site empty. The setting lives in the factory database, not in this repository.
