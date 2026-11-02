# Changelog

All notable changes to this project are documented in this file. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Release publishing at the production gate: one forge Release per approved batch (`products.releaseMode` `notes-only` or `factory`), user-language notes, `releaseUrl` on Tickets, CHANGELOG MR in factory mode (#106).
- Security: MCP sessions authenticate with agent keys (`/settings/api-key`); gate tools (`approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes`) refuse them. Existing personal API keys are disabled by migration: mint an agent key and re-add the MCP server ([session mode](docs/session-mode.md#agent-identity)). Refs #166.
