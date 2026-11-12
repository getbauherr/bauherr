# Releasing

One git tag publishes everything. From `main`:

```bash
git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1
```

[`release.yml`](https://github.com/getbauherr/bauherr/blob/main/.github/workflows/release.yml) (environment `release`, tag must be on `main`) first pushes the multi-arch image `ghcr.io/getbauherr/bauherr:<version>` (`latest` only for versions without a `-pre` suffix), then stages npm `bauherr@<version>` from `packages/cli` with provenance via trusted publishing (`npm stage publish`; no token stored, so setup-node has no `registry-url` (it would write a token placeholder into `.npmrc` and break OIDC; `NODE_AUTH_TOKEN` is unset before publish); the npm package settings name this repository and workflow and allow staged publishing only). Pre-releases get the npm tag `next`. A maintainer approves the staged version (`npm stage approve <stage-id>` or on npmjs.com) to make it installable. The CLI pins the image tag to its own version.
