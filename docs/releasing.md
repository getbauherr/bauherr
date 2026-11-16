# Releasing

Images exist only for versions. Merges to `main` publish no image; a version goes out in two manual steps from `main`, with a test on your own deployment in between: cut a release candidate, then promote it.

Primary path: the **Releases page** of Bauherr (`/releases`, Admin only). It works through the forge adapter, so it is the same for GitHub and GitLab Products; CI only builds and deploys the tag.

1. **Cut release candidate**: tick the done Tickets, pick the version from the select (`X.Y.Z-rc.1` of the patch, minor or major bump; for an open line only `rc.N+1`), confirm. Bauherr tags the newest merge sha and creates the release (pre-release), and records `releasedIn = vX.Y.Z-rc.N` on the Tickets. An `rc.N+1` must contain the previous rc's commit (else refused), its notes cover the Tickets since that rc and say it supersedes it.
2. **Deploy the RC and test it**, on your own instance: `BAUHERR_VERSION=X.Y.Z-rc.N docker compose pull app && BAUHERR_VERSION=X.Y.Z-rc.N docker compose up -d`. A fix after a bad RC: merge it, cut again.
3. **Promote**: choose "Promote vX.Y.Z-rc.N" in the action select next to the button and confirm. Allowed only for the newest rc of an open line while `vX.Y.Z` does not exist on another commit. Bauherr tags `vX.Y.Z` on the same sha as the rc, publishes the final release with the notes of every rc of the line, sets the Tickets to `releasedIn = vX.Y.Z` (Comment "Released in vX.Y.Z (tested as vX.Y.Z-rc.N)"), opens the CHANGELOG MR and updates the Product's last release. A retry finishes what is left; it creates no second tag, release, Comment or MR.

The open line and the last final are read from the **tags** (also tags without a release, as the CLI fallback makes them). GitLab has no pre-release flag: a tag `X.Y.Z-<suffix>` (every `-rc.N`) is the pre-release convention, reported as pre-release by the GitLab adapter and never `latest`. The tag pipeline of the Product (GitLab CI on tags) builds the image from the tag. The forge contract cannot list GitHub drafts; `createRelease` on GitHub publishes an existing draft of the tag (left by `cut-rc.yml`) instead of creating a second release. If a promote fails after the release was published, the tag then exists and the page no longer shows the line as open: re-run the same call or finish the Ticket records by hand.

The Product needs release mode `manual` (Settings > Product > Release notes) so that the factory does not tag on its own.

## CLI fallback (GitHub Actions)

If the Releases page is unavailable, the same two steps run from the workflows (they start `release.yml` themselves):

```bash
gh workflow run cut-rc.yml -f bump=minor     # patch | minor | major; tags vX.Y.Z-rc.N, publishes :X.Y.Z-rc.N
gh workflow run promote.yml                  # tags vX.Y.Z on the RC's commit, publishes :X.Y.Z and :latest
```

[`cut-rc.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/cut-rc.yml) computes the next version from the `v*` tags: if an unpromoted RC line for the target exists it is `rc.N+1`, else the latest final tag is bumped and it starts at `rc.1`. It tags `main` HEAD, starts `release.yml` for the tag and creates (or updates) the draft GitHub Release `vX.Y.Z` with generated notes since the last final tag.

[`promote.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/promote.yml) takes an RC tag (default the newest). It refuses unless the tag is an RC, the newest RC of its `X.Y.Z`, and `vX.Y.Z` does not exist. It tags `vX.Y.Z` on the same commit and starts `release.yml`, which rebuilds from that commit and, when image and npm are done, publishes the draft GitHub Release (if there is one) as the latest release.

Both workflows start `release.yml` with `gh workflow run --ref <tag>`, because a tag pushed with `GITHUB_TOKEN` triggers no workflow. A tag pushed by the Releases page (GitHub App token) or by hand triggers it directly.

[`release.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/release.yml) (runs on every `v*` tag; environment `release`, tag must be on `main`) first pushes the multi-arch image `ghcr.io/getbauherr/bauherr:<version>` (`latest` only for versions without a `-pre` suffix), then stages npm `bauherr@<version>` from `packages/cli` with provenance via trusted publishing (`npm stage publish`; no token stored, so setup-node has no `registry-url` (it would write a token placeholder into `.npmrc` and break OIDC; `NODE_AUTH_TOKEN` is unset before publish); the npm package settings name this repository and `release.yml` and allow staged publishing only). Pre-releases get the npm tag `next`. A maintainer approves the staged version (`npm stage approve <stage-id>` or on npmjs.com) to make it installable. The CLI pins the image tag to its own version.

## Staging and production checks

[`staging.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/staging.yml) runs on every push to `main` (one run per sha). It builds the image, starts it once against a throw-away Postgres (it migrates on start, like `compose.yaml`) and requires `GET /api/health` to return `{"ok":true}`, then reports the check `staging` on that sha. It pushes no image. [`production.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/production.yml) reports the check `production` on a Ticket's merge sha after the owner's approval; the change ships with the next release.

Run any version locally with `BAUHERR_VERSION=<version> docker compose up -d` (compose.yaml's image is `ghcr.io/getbauherr/bauherr:${BAUHERR_VERSION:-dev}`); a checkout builds its own `dev` image.

To let merged Tickets move to "on staging" by themselves, an Admin sets the bauherr Product's Deploy tab once: deploy mode "checks", deploy checks `staging`, staging site empty. The setting lives in the factory database, not in this repository.
