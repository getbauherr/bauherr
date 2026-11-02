# packages/adapters

GitHub, GitLab and Planka behind one contract. Private until the `@bauherr` scope is needed.

Drivers: `GithubBackend` (`github.ts`), `GitlabBackend` (`gitlab.ts`, self-hosted or gitlab.com, PAT), `FakeBackend` (`fake.ts`). Live-forge contract suites: `pnpm test:github`, `pnpm test:gitlab` (skipped unless `GITLAB_TOKEN`, `GITLAB_BASE_URL`, `GITLAB_SANDBOX` are set).
