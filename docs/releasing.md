# Releasing

Images exist only for versions. Merges to `main` publish no image. A version goes out in two manual steps from `main`, with a test on your own deployment in between: cut a release candidate, then promote it.

The primary path is the **Releases page**, `/releases`, Admin only. It works through the forge adapter, so it is the same for GitHub and GitLab Products. CI only builds and deploys the tag.

1. **Cut release candidate.** Tick the done Tickets, pick the version `X.Y.Z-rc.1` of the patch, minor or major bump, and confirm. For an open line only `rc.N+1` is offered. Bauherr tags the newest merge sha, creates a pre-release and records `releasedIn = vX.Y.Z-rc.N` on the Tickets. An `rc.N+1` must contain the previous rc's commit. Its notes cover the Tickets since that rc.
2. **Deploy the RC and test it** on your own instance:

   ```bash
   BAUHERR_VERSION=X.Y.Z-rc.N docker compose pull app && BAUHERR_VERSION=X.Y.Z-rc.N docker compose up -d
   ```

   After a bad RC, merge the fix and cut again.
3. **Promote.** Choose "Promote vX.Y.Z-rc.N" in the action select and confirm. It is allowed only for the newest rc of an open line, while `vX.Y.Z` does not exist on another commit. Bauherr then does five things:
   - tags `vX.Y.Z` on the rc's sha
   - publishes the final release with the notes of every rc of the line
   - sets `releasedIn = vX.Y.Z` on the Tickets, with the Comment "Released in vX.Y.Z (tested as vX.Y.Z-rc.N)"
   - opens the CHANGELOG MR
   - updates the Product's last release

   A retry finishes what is left and creates no second tag, release, Comment or MR.

The open line and the last final are read from the **tags**, including tags without a release. A tag `X.Y.Z-<suffix>` is the pre-release convention, because GitLab has no pre-release flag. The GitLab adapter reports it as pre-release and never `latest`. The Product's tag pipeline builds the image from the tag.

The forge contract cannot list GitHub drafts. On GitHub `createRelease` publishes an existing draft of the tag, left by `cut-rc.yml`, instead of creating a second release.

If a promote fails after publishing, the page offers "Finish promoting vX.Y.Z-rc.N" while a Ticket still says rc, or the final release or CHANGELOG MR is missing. Run it again.

## Release notes format

One line per Ticket, at most 15 words, linked to the Ticket. The line is the first "what you get" bullet of its staging summary, else the Ticket title. Lines are grouped by feature area:

- **Changed behaviour** comes first: a `!` in the conventional type, or the label `breaking`.
- **One group per feature area**, biggest first, `Other` last. A Ticket's area is the area of the feature whose `source` paths its merge request changed. Most hits win; no hit gives `Other`. Without a map the group is `Changes`.
- **`Internal: N changes`** comes last. It holds the types `ci`, `test`, `refactor`, `chore`, `build`, `deps`, and `docs` without an area. `/release-notes` expands it and filters by area.

The map is `products/<slug>/feature-map.yaml` of the Knowledge repo, else `docs/feature-map.yaml` of the Product's own repo.

`pnpm --filter server regen-release-notes [<product-slug>]` strips the bullet floods from `CHANGELOG.md`. With a slug it also rewrites each released version from the stored Ticket data and `releaseNotes`.

The Product needs release mode `manual` under Settings > Product > Release notes, so the factory does not tag on its own.

## CLI fallback on GitHub Actions

If the Releases page is unavailable, the workflows run the same two steps and start `release.yml` themselves:

```bash
gh workflow run cut-rc.yml -f bump=minor
gh workflow run promote.yml
```

`bump` is `patch`, `minor` or `major`. `cut-rc.yml` tags `vX.Y.Z-rc.N` and publishes `:X.Y.Z-rc.N`. `promote.yml` tags `vX.Y.Z` on the RC's commit and publishes `:X.Y.Z` and `:latest`.

[`cut-rc.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/cut-rc.yml) computes the next version from the `v*` tags. If an unpromoted RC line exists it is `rc.N+1`. Otherwise it bumps the latest final tag and starts at `rc.1`. It tags `main` HEAD, starts `release.yml` and creates or updates the draft GitHub Release with generated notes.

[`promote.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/promote.yml) takes an RC tag, default the newest. It refuses unless the tag is the newest RC of its `X.Y.Z` and `vX.Y.Z` does not exist. It tags `vX.Y.Z` on the same commit and starts `release.yml`. That rebuilds from the commit and then publishes the draft as the latest release.

Both start `release.yml` with `gh workflow run --ref <tag>`, because a tag pushed with `GITHUB_TOKEN` triggers no workflow. A tag pushed by the Releases page or by hand triggers it directly.

[`release.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/release.yml) runs on every `v*` tag. It needs the environment `release` and the tag on `main`. It does two things in order:

1. Pushes the multi-arch image `ghcr.io/getbauherr/bauherr:<version>`. `latest` is only for versions without a `-pre` suffix.
2. Stages npm `bauherr@<version>` from `packages/cli` with provenance, using `npm stage publish` and trusted publishing.

No npm token is stored. `setup-node` has no `registry-url`, since it would write a token placeholder into `.npmrc` and break OIDC. `NODE_AUTH_TOKEN` is unset before publish. The npm package settings name this repository and `release.yml`, and allow staged publishing only.

Pre-releases get the npm tag `next`. A maintainer approves the staged version with `npm stage approve <stage-id>` or on npmjs.com. The CLI pins the image tag to its own version.

## Staging and production checks

[`staging.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/staging.yml) runs on every push to `main`, one run per sha. It builds the image and starts it once against a throw-away Postgres. The app migrates on start, like `compose.yaml`. The run requires `GET /api/health` to return `{"ok":true}` and reports the check `staging` on that sha. It pushes no image.

[`production.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/production.yml) reports the check `production` on a Ticket's merge sha after the owner's approval. The change ships with the next release.

Run any version locally with `BAUHERR_VERSION=<version> docker compose up -d`. The image is `ghcr.io/getbauherr/bauherr:${BAUHERR_VERSION:-dev}`. A checkout builds its own `dev` image.

To let merged Tickets move to "on staging" by themselves, an Admin sets the bauherr Product's Deploy tab once: deploy mode "checks", deploy checks `staging`, staging site empty. The setting lives in the factory database.
