# Security policy

Report vulnerabilities privately via [GitHub private vulnerability reporting](https://github.com/getbauherr/bauherr/security/advisories/new). Do not open public issues for security problems.

Only the latest release is supported until v1.0.

Provider credentials for `bedrock-iam` and `foundry-entra` are stored in plain text in the gateway `config.yaml` (0600); ambient-identity presets are limited to single-Workspace instances (see `docs/gateway-smoke.md`).

Gate labels (`bauherr:approved:plan`, `bauherr:approved:staging`) set by anyone but a gate owner, an Admin or the factory's own recorded approval are removed (see `docs/spec/workflow.md`, section 2).
