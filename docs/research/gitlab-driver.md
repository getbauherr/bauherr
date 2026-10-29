# GitLab driver (research, ticket #14)

Scope: one driver = `Forge` + `TicketSource` over one Connection (#6). Probed 2026-10-29 on gitlab.com 19.6.0-pre
(`GET /metadata` 200) with a **read-only** token (user `sbuckpesch`, Owner of group `einsfuenf.de`, Free plan,
project `einsfuenf.de/klima-portal` id 67311433). No write token exists: every write is "?" = unverified (endpoint, role/scope and docs tier given).
"V" = verified live; "D" = docs only; "?" = unverified. Docs base: https://docs.gitlab.com.
Caveat V: klima-portal has **0 issues** (`/issues?scope=all&state=all` -> `x-total: 0`, 200), so issue-level read probes ran on public
`gitlab-org/gitlab` issue 628976 (token used, read-only). MR/pipeline/job probes ran on klima-portal MR !196.

## 1. Auth

| Option | gitlab.com Free | Self-managed (any license) | Bot identity | Lifetime / rotation |
|---|---|---|---|---|
| **Project/group access token** | **Premium+ only**: "On GitLab.com, project access tokens require a Premium or Ultimate subscription" ([doc](https://docs.gitlab.com/user/project/settings/project_access_tokens/)) (D) | all licenses (D) | creates a bot user; assignable not stated in doc (?) | max 365 d (400 d behind FF `buffered_token_expiration_limit`, admin-configurable >=17.6); rotate = UI, doc names no API (D; API `POST .../access_tokens/:id/rotate` exists upstream, unverified) |
| **Service account (group)** | **Free yes since 18.11**, max 100 per top-level group, Owner of top-level group creates, owner must verify identity; no seat used ([doc](https://docs.gitlab.com/user/profile/service_accounts/)) (D) | Free: 100 per instance; admin creates (or Owner if admin allows) (D) | real user (type service_account), added as project/group member -> assignable in principle (?) | PAT, default 365 d; no-expiry allowed if group/instance setting "Require expiration dates for service accounts" cleared (D) |
| **OAuth app** (group- or instance-owned) | Free (D); acts **as the authorising human** | Free (D) | none: it is the human | access token **2 h**, refresh token mandatory ([doc](https://docs.gitlab.com/integration/oauth_provider/)) (D) |
| **Personal access token** (human or machine-user) | Free (D) | Free (D) | the human (or a paid-seat machine user) | max 365 d, rotate in UI |

Probes V: `GET /groups/einsfuenf.de/access_tokens` 200 `[]`, `GET /projects/:id/access_tokens` 200 `[]` (listing works; creation tier-gated by docs, not provable read-only);
`GET /groups/einsfuenf.de/service_accounts` 200 `[]` (endpoint exists on this Free group); `GET /applications` 403 (instance admin only).

Writes (?): `POST /groups/:id/service_accounts` `{name,username}` (Owner, Free per [API doc](https://docs.gitlab.com/api/service_accounts/));
`POST /groups/:id/service_accounts/:user_id/personal_access_tokens` `{name,scopes:["api"],expires_at}`; then
`PUT /projects/:id/members` / `POST /projects/:id/members {user_id, access_level:30}` for the service account.

**Recommendation v0.1:** group **service account + PAT** (scope `api`, Developer on the product project(s)). It is the only Free-gitlab.com option that gives a non-human identity;
works unchanged on self-managed (admin or Owner creates it). Fallback / dev: personal access token (acts as the human; claims indistinguishable, same caveat as GitHub PAT).
OAuth app only for a later "connect with GitLab" UX (2 h tokens + refresh state to custody; still no bot).
Store `token` + `expires_at`; wizard must show expiry and warn at 14 d; rotation is manual (service-account PAT: create new via API, swap, revoke old) until verified.
No project access token on Free gitlab.com, so do not design around it; accept it on self-managed / Premium as a fallback Connection kind.

**Bot as assignee (Claim):** service account is a member user, so `PUT /projects/:id/issues/:iid {assignee_ids:[<sa id>]}` should work for Developer+ members (?, needs write token).
Doc silent on both service accounts and project-bot assignability. Verify first thing with a write token: `GET /projects/:id/users` lists members incl. bots (V: returns 3 humans now), then assign.
Fallback unchanged from #6: Postgres-serialised claim + label `bauherr:claimed`.

**Rate limits.** gitlab.com V (headers on every call): `ratelimit-name: burst_traffic_per_user_free_plan`, `ratelimit-limit: 100` (per minute), also `ratelimit-observed/remaining/reset`.
Docs list a *proposed* plan-based limit: Free 5 000/h sustained + 100/min burst (200 web); Premium 15 000/h + 1 250/min ([doc](https://docs.gitlab.com/user/gitlab_com/rate_limits/)) (D).
In force (D): issue creation 200/min, **note creation 60/min** (issues + MRs), unauthenticated 500/min per IP; 429 carries `Retry-After`.
Limit is **per user**: a service-account PAT has its own budget, independent of the human. Poll budget: 1 request per product per interval + 1 per moved Ticket stays far below 100/min.
Self-managed: authenticated/unauthenticated throttles **off by default**, when on default 7200 / 3600 per 3600 s ([doc](https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/)) (D). Same `RateLimit-*` + `Retry-After` headers.

## 2. Tier facts (gitlab.com Free)

| Capability | Free? | Evidence |
|---|---|---|
| Read issues/labels/MRs/pipelines/jobs/events/members | yes | V, all 200 (section 6) |
| `relates_to` link create: `POST /projects/:id/issues/:iid/links?target_project_id&target_issue_iid&link_type=relates_to` | **yes (D)**, write ?| [related issues](https://docs.gitlab.com/user/project/issues/related_issues/): "relates to" Free+; `GET .../links` exists V (200 on gitlab-org issue; 404 on nonexistent klima-portal issue 1). Role: update on both issues (Developer+) |
| `blocks` / `is_blocked_by` create (same endpoint, `link_type=blocks`) | **no (D)** | same page: blocking links "Premium, Ultimate". API page lists the values for all tiers and documents no error ([doc](https://docs.gitlab.com/api/issue_links/)); expected failure mode (403/4xx) unverified. Driver: probe once per Connection by creating+deleting a link in a scratch issue; else `nativeBlocking=false`, body convention |
| Sub-ticket (issue under issue) | **no** | V GraphQL `project.workItemTypes` = Incident, Issue, Task, Ticket (no Epic). `Issue` HIERARCHY `allowedChildTypes=[Task]`, `allowedParentTypes=[]`; `Task` parents = Incident/Issue/Ticket. Task and parent must be in the same project ([tasks](https://docs.gitlab.com/user/tasks/)). -> `nativeSubTickets=false`: body convention + `relates_to` mirror |
| Uploads `POST /projects/:id/uploads` (multipart `file`) | **yes (D)**, write ? | [doc](https://docs.gitlab.com/api/project_markdown_uploads/) tier Free+; response `{id,alt,url,full_path,markdown}`; role Developer+ in practice (?). `GET /projects/:id/uploads` Maintainer/Owner V 200 `[]`. Embed `markdown` in a comment. Private project: link only resolves for members (D, not stated; expected) |
| Scoped labels `stage::plan` | **no as a feature** (D) | [labels doc](https://docs.gitlab.com/user/project/labels/): "Tier: Premium, Ultimate" (mutual exclusivity of same key). A label literally named `stage::plan` is still creatable (?, plain name); exclusivity is **not enforced** on Free -> driver must remove the old `stage::*` label itself (remove+add in one `PUT` via `labels=` full set or `add_labels`+`remove_labels`) |
| Close: `PUT /projects/:id/issues/:iid {state_event:"close"}` | yes (D), write ? | [issues API](https://docs.gitlab.com/api/issues/): `state_event` close/reopen; page documents **no close reason / state reason** -> `close-reason::<r>` label stays (plain label, Free) |
| Add/remove labels | yes (D), write ? | `add_labels`, `remove_labels` (comma list), `labels` replaces; unknown label names are auto-created on issue update (?, upstream behaviour; verify) |
| Comment `POST /projects/:id/issues/:iid/notes {body}` | yes (D), write ? | note creation limit 60/min |
| MR approvals | optional approvals yes; **required rules no** | V `GET /projects/:id/approvals` 200 (`approvals_before_merge:0`), `GET /approval_rules` 200 `[]`, `approval_state` 200 `rules:[]`. Doc: Free approvals "optional and don't prevent merging"; required approvals / code owners Premium+ ([doc](https://docs.gitlab.com/user/project/merge_requests/approvals/)). Human gate on Free = Bauherr's own approval + branch protection (V: `main` protected, push Maintainer) |
| Work-item custom status / Epics | no | Epic absent from `workItemTypes` (V) |
| Service accounts | yes (18.11+) | D, see section 1 |
| Webhooks (project) | yes | [API doc](https://docs.gitlab.com/api/project_webhooks/) tier Free+; limits: 500 calls/min per top-level namespace on Free, 100 hooks/project, 10 s timeout (D) |

Capabilities per Connection (extends #6): probe `GET /version` (`/metadata`: `version`, `enterprise`) plus V `workItemTypes` (Epic present => Premium+) plus a one-time
blocks-link scratch probe. gitlab.com `plan` field is `null` for this token, so plan is **not readable**; infer from behaviour.

## 3. Polling

- **Issues:** `GET /projects/:id/issues?state=all&updated_after=<ISO Z>&order_by=updated_at&sort=asc&per_page=100`. V on gitlab-org: 200, `updated_after` inclusive ("on or after" per [doc](https://docs.gitlab.com/api/issues/)) -> keep cursor = last `updated_at`, de-dup by `iid`+`updated_at`.
  Null cursor: omit `updated_after` (GitHub's 1970 trap not tested; omit anyway). `scope` defaults to `all` on project endpoint (D).
- **Pagination:** offset (default; `x-next-page`, `Link rel=next`, `x-total` omitted above 10 000 rows) vs **keyset** `pagination=keyset` (V 200 on gitlab-org issues with `updated_at` order: `Link` carries `cursor=...`; no `x-total`). Doc: project issues keyset since 18.3, `order_by` in created_at|updated_at|title|id|weight|due_date|relative_position ([doc](https://docs.gitlab.com/api/rest/#keyset-based-pagination)). Use keyset when `/version` >= 18.3, else offset. Follow `Link rel=next` verbatim; keyset ends when `Link` absent.
  V: `pagination=keyset` on **merge_requests** is ignored (still offset headers, x-total 196) -> MRs use offset.
- **Notes:** `GET /projects/:id/issues/:iid/notes?updated_after=&order_by=updated_at&sort=asc` V 200 on gitlab-org (returns system notes too, e.g. "added ... as parent item": filter `system:true`). Fetch only for Tickets whose `updated_at` moved (as in #6). No project-wide notes list: per-Ticket calls.
- **Derived events** (diff against stored pointer is primary; these give actor/time):
  `GET .../issues/:iid/resource_label_events` V 200 (paginated, `user` = actor);
  `.../resource_state_events` V 200; `.../resource_assignee_events` **404** (no such endpoint; diff assignees from the issue or read system notes).
  MR: `resource_state_events` V 200 (klima-portal !196), `resource_label_events` V 200.
- **Relation changes:** unknown whether `links` changes bump `issue.updated_at` (? not probed: needs write). Assume not (GitHub precedent): refresh `/links` for each moved Ticket + slow reconciliation.
- **MR pipelines + jobs:** `GET /projects/:id/merge_requests/:iid/pipelines` V 200 (`source:"merge_request_event"`, `ref:"refs/merge-requests/196/head"`, `status:"manual"`);
  `GET /projects/:id/pipelines/:pid/jobs?per_page=100` V 200 (12 jobs, 6 pages at per_page=2; fields `name,stage,status,allow_failure,started_at,finished_at`); `.../pipelines/:pid/bridges` V 200 `[]`.
  Checks mapping: pipeline `status` + required jobs (`allow_failure:false`); head pipeline also in `GET /merge_requests/:iid` `head_pipeline`. Files: `GET /merge_requests/:iid/diffs?per_page=` V 200 (`/changes` also 200 but deprecated).
  MR list: `merge_requests?updated_after=&order_by=updated_at&sort=asc` V 200.
- **Webhook (optional accelerator, poll stays mandatory):** register `POST /projects/:id/hooks` `{url, token, issues_events, confidential_issues_events, note_events, merge_requests_events, pipeline_events, job_events:false, enable_ssl_verification:true}`
  (Maintainer/Owner; tier Free; ? unverified; V `GET /hooks` 200 `[]`). Verify: `X-Gitlab-Token` == configured secret (plain compare, constant-time) -- docs call it weaker; prefer the signing token (`webhook-signature: v1,<b64 HMAC-SHA256>` + `webhook-id` + `webhook-timestamp`, check freshness) when the instance supports it (D, [doc](https://docs.gitlab.com/user/project/integrations/webhooks/)). Dedup key: `webhook-id` (legacy `Idempotency-Key`; `X-Gitlab-Event-UUID` is not unique for recursive hooks). Retries unspecified; auto-disable after 4 consecutive failures (backoff 1 min -> 24 h), permanent after 40; 10 s timeout -> ack fast, trigger an early poll only.
  **System hooks (self-managed, admin only):** cover project/group/user lifecycle + push/tag/MR, **no issue or note events** ([doc](https://docs.gitlab.com/administration/system_hooks/)) -> useless for tickets; use project hooks. Per-project hook registration is the only route.

## 4. Stages

Recommend labels `bauherr:stage:<name>` (not `stage::<name>`), one per Ticket, same as GitHub driver, because scoped labels are Premium+ (section 2) and the driver must work on Free.
Same for `close-reason::<r>` -> rename `bauherr:close-reason:<r>` for namespace hygiene (decision for #6 owner; `::` would silently become plain labels on Free anyway).
Optional upgrade: if the Connection reports scoped-label support (Premium probe), use `bauherr::stage::x`-style scoped labels so GitLab enforces one-per-key; driver logic (remove-then-add) is correct either way.
Boards: a board list is a label list (project boards `GET /projects/:id/boards` V 200 `[]` here); boards are a view over the same labels, so labels are the source of truth. Moving a card = label change, which `resource_label_events` reports. Create labels first: `POST /projects/:id/labels {name,color}` (Reporter+? Developer+, ?). Group labels (`GET /groups/:id/labels` V 200 `[]`) would avoid per-project setup (`include_ancestor_groups=true`).

## 5. Self-managed vs gitlab.com

| Topic | gitlab.com | Self-managed |
|---|---|---|
| Version | 19.6.0-pre (V), continuous | any; read `GET /version` (needs auth) and gate: keyset issues >=18.3, Free service accounts >=18.11, WI hierarchy GraphQL |
| Rate limits | per-user burst 100/min Free (V) + proposed 5 000/h (D); note creation 60/min | throttles off by default; admin-tunable; same headers |
| Project access tokens | Premium+ | all licenses (bot per project/group) |
| Service accounts | Free, 100 per top-level group; Owner creates + identity verification | Free, 100 per instance; admin (or Owner if allowed) |
| Premium features | gated by group plan (blocks links, scoped labels, required approvals, Epics) | gated by license; an unlicensed instance behaves like Free; a licensed one has them -> probe, do not hardcode |
| Webhooks | 500 calls/min per top-level namespace on Free | limits admin-set; may block outbound to private IPs/localhost (admin setting "Allow requests to the local network") -> Bauherr must be reachable and allow-listed; poll still works |
| System hooks | n/a | admin-only, no issue/note events |
| OAuth | group-owned apps | + instance-wide apps (admin); default 2 h token, admin-changeable |
| API base | `https://gitlab.com/api/v4` | `https://<host>/api/v4`, optionally relative-URL root; TLS with private CA possible -> Connection needs `baseUrl` + optional CA |
| GraphQL | `/api/graphql`, work-item types V | same; some work-item/hierarchy fields behind feature flags on older versions (D) -> REST first, GraphQL only to probe `workItemTypes` |
| Uploads | `/uploads/<hash>/<file>` relative URLs resolve against the project | same; admin max attachment size setting applies (?) |

## 6. Probe log (read-only, klima-portal unless noted; all with the RO token, `--max-time 30`)

| Request | Status | Note |
|---|---|---|
| `GET /version`, `/metadata` | 200 | 19.6.0-pre, `enterprise:true`, `plan:null` |
| `GET /user` | 200 | `ratelimit-name: burst_traffic_per_user_free_plan`, limit 100 |
| `GET /projects/:id`, `/groups/einsfuenf.de` | 200 | `permissions.group_access.access_level: 50` (Owner); `issues_enabled:true`, `open_issues_count:0` |
| `GET /projects/:id/issues?updated_after=2026-10-01T00:00:00Z&order_by=updated_at&sort=asc&per_page=2&state=all` | 200 | `[]`, `x-total: 0` (project has no issues) |
| same, `pagination=keyset` | 200 | `[]` |
| same on `gitlab-org%2Fgitlab`, offset and keyset | 200 | offset: `x-total: 391`, `x-next-page: 2`; keyset: `Link` with `cursor=` |
| `GET /projects/:id/labels`, `/groups/einsfuenf.de/labels` | 200 | `[]` |
| `GET /projects/:id/merge_requests?state=all&per_page=1` | 200 | `x-total: 196` |
| `GET .../merge_requests?updated_after=2026-10-27T00:00:00Z&order_by=updated_at&sort=asc` | 200 | 2 MRs |
| `GET .../merge_requests/196/{pipelines,notes?updated_after,resource_state_events,resource_label_events,approvals,approval_state,diffs,changes,discussions}` | 200 | pipelines: 1 (`merge_request_event`, `manual`) |
| `GET .../pipelines/2994845015/{jobs,bridges}` | 200 | jobs total 12; bridges `[]` |
| `GET .../pipelines?per_page=1` | 200 | 1243 pipelines; latest `main` scheduled `failed` |
| `GET .../issues/1`, `.../issues/1/links` (klima-portal) | 404 | issue absent |
| `GET gitlab-org%2Fgitlab/issues/628976/{links,notes?updated_after,resource_label_events,resource_state_events}` | 200 | `resource_assignee_events` -> 404 |
| `GET .../uploads`, `/hooks`, `/boards`, `/access_tokens`, `/approvals`, `/approval_rules`, `/events`, `/invited_groups`, `/protected_branches` | 200 | uploads/hooks/boards/tokens `[]`; `main` protected |
| `GET /projects/:id/members/all`, `/users`, `/groups/einsfuenf.de/members` | 200 | 3 humans, no bots |
| `GET /groups/einsfuenf.de/{access_tokens,service_accounts}` | 200 | `[]` |
| `GET /applications`, `/application/settings` | 403 | admin only |
| GraphQL `project.workItemTypes{widgetDefinitions}` | 200 | Incident, Issue, Task, Ticket; Issue children = Task only |
| unauthenticated `POST .../issues/:iid/links` on gitlab-org | 401 | sanity only, nothing written |

## 7. Open risks (all need a write token on a sandbox project, e.g. `einsfuenf.de/bauherr-sandbox`)

1. Service account created on this Free group works end to end (creation, PAT, 100-limit, identity verification step) and **can be assigned** via `assignee_ids` (Claim).
2. `blocks` link on Free: exact failure status/body; whether `relates_to` create and `DELETE /links/:id` work.
3. Does a link change bump `updated_at`? Does a label add bump it (expected yes)? Do system notes appear in `notes?updated_after`?
4. Label auto-create on `add_labels`; label names containing `::` and `:` on Free; exclusivity truly not enforced.
5. Upload: size limit, URL visibility to non-members in a private project, `markdown` embedding in a comment.
6. Webhook register, `X-Gitlab-Token` / signing-token behaviour, redelivery; gitlab.com Free 500 calls/min namespace cap shared with the product's own hooks.
7. Per-user rate limit 100/min burst (V) is low if one factory serves many products via one PAT -> one service account per Connection; backoff on 429 with `Retry-After`.
8. Free plan is not machine-readable (`plan:null`); capability probing relies on behaviour. Docs say "proposed" for the 5 000/h limit: re-check before relying on it.
9. Service-account Free availability is only 18.11+ (docs); older self-managed needs PAT-of-human or project access token (all licenses there).
10. Parent-mirror via `relates_to` needs same-project or `target_project_id`; relations stay in one Ticket source (v0.1), so same project only.
