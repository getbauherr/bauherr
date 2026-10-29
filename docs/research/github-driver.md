# GitHub driver (research, ticket #13)

Scope: one driver = `Forge` + `TicketSource` over one Connection (#6). Verified 2026-10-29 against the private repo
`getbauherr/sandbox` with the owner's token (classic OAuth `gho_`, scopes `admin:org, gist, project, repo, workflow`),
REST `X-GitHub-Api-Version: 2022-11-28`. Sandbox cleaned afterwards (issues/PR closed, branch + hook + labels deleted, repo kept).
"V" = verified live; "D" = from docs only; "?" = unverified.

## 1. Auth: GitHub App vs fine-grained PAT

**Recommendation: GitHub App for v0.1; fine-grained PAT as the fallback / dev-mode Connection.**

### Permissions (identical for both; names are GitHub's fine-grained names)
Source: [permissions required for fine-grained tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) (D; the write paths below were V with a broader token, so the *minimal* set is unverified).

| Need | Permission | Level |
|---|---|---|
| Issues CRUD, comments, labels, assignees, close/reopen | Issues | write |
| Sub-issues (`POST .../sub_issues`), dependencies (`POST .../dependencies/blocked_by`) | Issues | write (no extra permission, D) |
| PR create / files / comments / review | Pull requests | write |
| `PUT contents`, `POST git/refs` | Contents | write |
| Edits to `.github/workflows/**` | Workflows | write (only if agents may touch workflows; otherwise leave off) |
| `GET commits/{sha}/check-runs`, `check-suites` | Checks | read (write only if Bauherr publishes its own check-runs) |
| Combined status `GET commits/{sha}/status` | Commit statuses | read |
| `POST/GET /repos/{o}/{r}/hooks` | Repository webhooks (`Webhooks`) | write |
| Repo metadata, collaborators/assignees list | Metadata | read (implicit) |
| Projects v2 (only if used, see section 3) | Organization `Projects` | write |

Surprise V: `POST /repos/{o}/{r}/check-runs` with a user token -> **403 "You must authenticate via a GitHub App."**; Checks *write* is App-only. Reading check-runs works with any token.

### GitHub App
- **Registration (wizard):** [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) (D). Bauherr serves a form that POSTs `manifest=<json>` (+`state`) to `https://github.com/settings/apps/new` (personal) or `https://github.com/organizations/{ORG}/settings/apps/new`. Manifest: `name`, `url`, `redirect_url`, `setup_url`, `public:false`, `default_permissions`, `default_events`, `hook_attributes{url,active}`. User clicks "Create"; GitHub redirects to `redirect_url?code=...&state=...`; Bauherr calls `POST /app-manifests/{code}/conversions` (no auth) and gets `id`, `pem`, `webhook_secret`, client id/secret. Code expires in 1 h; endpoint is rate-limited. Bauherr stores `pem` + `webhook_secret` (encrypted).
- **Install:** user is sent to `https://github.com/apps/{slug}/installations/new` (choose account + "Only select repositories"); GitHub redirects to `setup_url?installation_id=N` (D; set `setup_on_update` for repo changes). Org installs need an org owner (or owner approval of the request). Bauherr stores `installation_id`; one Connection = one installation.
- **Token:** sign a JWT (RS256, <=10 min) with the pem -> `POST /app/installations/{id}/access_tokens` -> installation token, **expires after 1 h** ([docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)). No refresh token: mint a new one (cache until ~5 min before `expires_at`). Body `repositories[]` / `permissions` can narrow a token per Run (least privilege for runner tokens). Token format is changing (`ghs_APPID_JWT`): do not assume 40 chars.
- **Rate limits** ([docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)): installation token starts at 5000/h, +50/h per repo beyond 20 and +50 per org user beyond 20, cap 12 500/h (15 000 on GHEC orgs); separate per installation, independent of the human's budget. GraphQL: points budget, 5000/h observed for the PAT (V: `rateLimit{limit:5000}`); App installations have the same base (D). Secondary limits (D): <=100 concurrent requests, 900 REST points/min (GET=1, writes=5), ~80 content-creating requests/min and 500/h.
- **Bot identity / Claim:** the App acts as `{slug}[bot]`; comments, PRs, commits via API are attributed to it. Check-runs can be published as the App. Whether `{slug}[bot]` can be an **issue assignee**: see "Claim evidence" below; unresolved.
- **Webhooks:** one URL per App, set at registration (optional for Bauherr: poll is mandatory).
- Cons: manifest + install is two browser round-trips; self-hosted Bauherr needs a reachable `redirect_url`/`setup_url` (localhost works for the redirect); private key to custody.

### Fine-grained PAT
- User creates it at `github.com/settings/personal-access-tokens/new`; one **resource owner** (user or one org) and chosen repos; the same permission table is ticked by hand. Org may require approval and may forbid PATs. Lifetime: user-chosen expiry (max 1 year; org policy can cap, "no expiry" may be disallowed) (D). No refresh -> manual rotation; failure mode is silent expiry.
- Rate limit: 5000/h **shared with that human's other tokens** (V: `x-ratelimit-limit: 5000`, resource `core`).
- Identity = the human. Everything the factory does is attributed to that person; assignee-based Claim is indistinguishable from the human claiming (breaks the "human assignee = hands off" rule). A dedicated machine-user account avoids this but costs a seat and ToS-wise is allowed for one machine user.
- Pros: wizard is "paste token", works on any GitHub incl. Enterprise without registering anything; good for local dev and self-hosting trials.
- Projects v2: fine-grained PATs cannot write user-owned projects (D, from GitHub's docs on `project` scope being classic-only: [using the API to manage projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) says classic PAT with `project` scope) -> another reason labels first.

### Claim evidence (bot as assignee)
- V: assigning `github-actions[bot]` and `copilot-swe-agent[bot]` via `POST /issues/{n}/assignees` with the owner token -> **403 Forbidden** (not 422; neither is installed on the repo). `GET /repos/{o}/{r}/assignees` lists only the owner; `GET .../assignees/{bot}` -> 404.
- V: GraphQL `Assignee` union = `Bot | Mannequin | Organization | User`, so a `Bot` actor *can* be an assignee type in principle; `suggestedActors(capabilities:[CAN_BE_ASSIGNED])` on the sandbox returns only the user (no App installed).
- D: Copilot is assignable only as a special case ([changelog 2025-12-03](https://github.blog/changelog/2025-12-03-assign-issues-to-copilot-using-the-api/), [discussion](https://github.com/orgs/community/discussions/164267): requires a user token, not an App token). No official doc says an arbitrary App `[bot]` is assignable via REST. **Cannot verify without registering and installing an App** (manual browser step; out of scope for this agent).
- **Fallback if not assignable:** Claim is *serialised in Postgres* anyway (#6); mirror it on GitHub with a label `bauherr:claimed` (or a machine-user assignee) and treat any human assignee as hands-off. Decide after a 10-minute manual test (install the App on `getbauherr/sandbox`, `POST /issues/1/assignees {"assignees":["<slug>[bot]"]}` with an installation token, check 201 + `assignees`).

## 2. Write verification (sandbox, owner token)

| Op | Request | Status / notes |
|---|---|---|
| Create label | `POST /repos/{r}/labels` | 201 |
| Create issue | `POST /issues` `{title,body,labels}` | 201; returns `number` and global `id` (the `id` is what sub-issue/dependency endpoints take) |
| Comment | `POST /issues/{n}/comments` | 201 |
| Add labels | `POST /issues/{n}/labels` `{labels:[..]}` | 200; **auto-creates unknown labels** (`bauherr:stage:plan` was created implicitly) |
| Remove label | `DELETE /issues/{n}/labels/{name}` | 200 (returns remaining); 404 "Label does not exist" if absent (not idempotent; tolerate 404) |
| Assign | `POST /issues/{n}/assignees` | 201; **invalid login is silently ignored** (`nonexistent-user-zzz9` -> 201, not in `assignees`); verify via response |
| Unassign | `DELETE /issues/{n}/assignees` (body) | 200 |
| Assign `[bot]` | see section 1 | 403 |
| Close `not_planned` | `PATCH {state:closed,state_reason:not_planned}` | 200, `state_reason` echoed, `closed_by` set |
| Close `completed` | idem | 200 |
| Close `duplicate` | idem | 200, accepted and echoed (third value exists) |
| Close plain | `PATCH {state:closed}` | 200, `state_reason: completed` (default) |
| Reopen | `PATCH {state:open}` (+`state_reason:"reopened"` optional) | 200, `state_reason: reopened` |
| Create sub-issue link | `POST /issues/{parent}/sub_issues {sub_issue_id: <global id>}` | 201 (returns the **parent**, `sub_issues_summary` populated). **Takes the global `id`, not `number`** (number -> 404). Does not create issues; link an existing one |
| 2nd parent | same, child already has a parent | 422 "Sub issue may only have one parent" (`replace_parent: true` exists, D, not exercised) |
| List sub-issues / parent | `GET /issues/{n}/sub_issues`, `GET /issues/{n}/parent` | 200 |
| Remove sub-issue | `DELETE /issues/{parent}/sub_issue {sub_issue_id}` | 200 |
| Add dependency | `POST /issues/{n}/dependencies/blocked_by {issue_id: <global id>}` | 201; again global `id` |
| Duplicate dependency | same | 422 "Target issue has already been taken" |
| List / remove | `GET .../blocked_by`, `GET .../blocking`, `DELETE .../blocked_by/{issue_id}` | 200 / 200 / 200 |
| Blocker closed | `GET .../blocked_by` after closing blocker | still lists it with `state:"closed"` -> Frontier must filter by blocker state |
| Issue fields | `GET /issues/{n}` | contains `parent_issue_url`, `sub_issues_summary{total,completed,percent_completed}`, `issue_dependencies_summary{blocked_by,total_blocked_by,blocking,total_blocking}`: cheap parent/blocked counts in one read |
| Create branch | `POST /git/refs {ref:refs/heads/x, sha}` | 201 (sha from `GET /git/ref/heads/main`) |
| Commit text file | `PUT /contents/{path} {message,content(b64),branch}` | 201; creates the commit directly on the branch |
| Commit PNG | `PUT /contents/.bauherr/attachments/1/shot.png` | 201; `html_url` stable, `download_url` carries a short-lived `?token=` for private repos |
| Commit workflow | `PUT /contents/.github/workflows/ci.yml` | 201 with `workflow` scope (App needs Workflows:write) |
| Open PR | `POST /pulls {title,head,base,body}` | 201; `mergeable: null` on creation (computed async); later `mergeable:true, mergeable_state:clean` |
| Comment on PR | `POST /issues/{pr}/comments` | 201 (conversation comment through the Issues API) |
| PR review | `POST /pulls/{pr}/reviews {event:COMMENT}` | 200 |
| List PR files | `GET /pulls/{pr}/files` | 200 `[ {filename,status,additions,..} ]`, binary file shows `additions:0` |
| Check-runs | `GET /commits/{sha}/check-runs` | 200; `total_count:0` with no CI; after adding a `pull_request` workflow: 1 run `{name:"ok", status:completed, conclusion:success, app.slug:"github-actions"}` within ~25 s. Check-run `name` = *job* name, not workflow name |
| Check-suites / combined status | `GET .../check-suites`, `.../status` | 200; status `pending`, `total_count:0` without legacy statuses |
| Create check-run | `POST /check-runs` (user token) | **403 App-only** |
| Webhook register | `POST /hooks {name:web,active:false,events:[..],config{url,content_type,secret}}` | 201; secret returned masked; events `issues,issue_comment,pull_request,check_run,sub_issues` accepted; `issue_dependencies` accepted; bogus name -> 422 "`x` is not a valid event name" |
| Webhook list / delete | `GET /hooks`, `DELETE /hooks/{id}` | 200 / 204 |
| Attachment | `POST /issues/{n}/attachments` | 404, no such endpoint |
| Asset upload | `POST uploads.github.com/repos/{r}/issues/{n}/assets` | 400 (that host only serves release assets) |

### Attachments (confirmed unsupported via API)
- The issue/comment file upload in the web UI (drag-drop -> `github.com/user-attachments/...`) has no public REST/GraphQL endpoint (V: 404/400 probes above; no endpoint in the REST reference). Capability `attachments: false` for GitHub Connections.
- Workarounds, in order:
  1. **Link** to the asset where it already lives (Product user's screenshot stored by Bauherr intake in its own object store) in the Comment/body: matches the glossary (assets are Linked, not pasted).
  2. **Commit under `.bauherr/attachments/{ticket}/{name}`** via contents API (V: 201) on the default branch (or a `bauherr/attachments` branch) and link/embed `https://github.com/{o}/{r}/blob/{branch}/{path}?raw=true`. In a **private repo** the image only renders for viewers with repo access (V: anonymous `GET` of the raw URL -> 404); Product users without repo access will not see it. Costs a commit per file and bloats history; cap size (contents API limit 100 MB, practical 1 MB for the JSON body).
- Recommendation: 1 as default, 2 as opt-in per Product; document that neither is a native Attachment.

## 3. Stages: labels vs Projects v2

- Projects v2 is **GraphQL-only** ([docs](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)). Mutations present (V, introspection): `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, `deleteProjectV2Item`, `updateProjectV2ItemPosition`, `createProjectV2Field`, ...
- Needs: classic PAT `project` (read: `read:project`); fine-grained PAT only for org projects; App installation token with org permission `Projects` (read/write) for org-owned projects. User-owned projects: App access unverified (docs silent) -> treat as unsupported.
- Setup cost per Product: resolve `projectV2(number)` id, `fields(first:..){... on ProjectV2SingleSelectField{id name options{id name}}}` for the Status field id and option ids, then `addProjectV2ItemById` (item must exist before field update; two calls) then `updateProjectV2ItemFieldValue {singleSelectOptionId}`. Field/option ids must be cached per Connection and re-resolved when humans rename columns.
- Projects v2 item changes do **not** bump the issue's `updated_at` (D, standard behaviour; ? not tested because creating a project is outside the sandbox repo) and are delivered only via `projects_v2_item` org webhooks, so polling would need a second GraphQL path.
- Labels: one REST call, atomic with other issue changes, show up in `issues?since=`/webhooks, auto-created on first use (V), work on GitLab with the same shape (scoped labels).

**Recommendation v0.1: labels as stages**, namespaced `bauherr:stage:<name>` (e.g. `bauherr:stage:plan`), exactly one per Ticket (driver removes the old on transition; remove tolerates 404). Projects v2 = later optional view-only mirror (write-through, never read) for Bauherren who want a board.

## 4. Polling and webhooks

### Polling (mandatory)
- `GET /repos/{o}/{r}/issues?state=all&since=<ISO>&sort=updated&direction=asc&per_page=100` ([docs](https://docs.github.com/en/rest/issues/issues#list-repository-issues)). Returns issues **and PRs** (PRs have a `pull_request` key; filter them out or route to Forge). Pagination: `Link: rel="next"` is cursor-style (`after=...&page=2`); follow the header, never build page numbers.
- `since` semantics (V): filters on `updated_at >= since`. **Omit `since` for a null cursor.** Any `since` below the repo's creation works as "all" except the epoch region: `since=1970-01-01T00:00:00Z` and `1970-01-01T00:00:01Z` -> 0 results; `1975-01-01`, `1980-01-01`, `1990-01-01`, `2000-01-01` -> all 4. Also V: **`since` without trailing `Z` -> 0 results** (`2026-10-29T12:58:00`); always send UTC with `Z`.
- Cursor = max `updated_at` seen, resent with `>=` (at-least-once; dedupe by `(number, updatedAt)`). 1-second timestamp resolution: re-fetch the last second; store the max.
- **List endpoint is eventually consistent**: right after closing the last open issue, `GET issues?state=open` still returned it (2 then 1 then 0 over ~3 s). A cursor poll that lags ~5 s behind "now" avoids missing late-indexed updates; at-least-once covers the rest.
- `GET /repos/{o}/{r}/issues/comments?since=<ISO>` (V: 200, whole repo, includes PR conversation comments; item has `issue_url`). Per-issue: `GET /issues/{n}/comments?since=`. Fetch comments only when `updatedAt` moved (matches #6). A new comment bumps the issue's `updated_at` (V: B 12:56:45 -> 12:58:48).
- **Relation changes do not bump `updated_at`** (V): remove/add of a sub-issue link and of a `blocked_by` dependency left `updated_at` of parent, child and blocker unchanged on all three issues. Close of the child changed `sub_issues_summary` (`completed:1`, after a moment: read-after-write lag, first read showed `completed:0`). Consequences: (a) the cached `parent`/`blockedBy` in the ticket pointer can go stale on poll alone; (b) refresh relations on every moved Ticket **and** run a slow reconciliation (e.g. every N polls: list `sub_issues` of open parents and `blocked_by` of open candidates, or read `issue_dependencies_summary` from the list payload and refetch only when counts differ - the list payload contains the summaries, V on single GET; list-payload presence not checked); (c) webhooks `sub_issues` / `issue_dependencies` deliver these when enabled.
- Derived events: `GET /issues/{n}/events` (V: `labeled, unlabeled, assigned, unassigned, closed, reopened, sub_issue_added`); `GET /issues/{n}/timeline` adds `commented`, `cross-referenced`, `parent_issue_added`, `blocked_by_added`. Repo-wide `GET /issues/events` exists (V: 200 returns `blocked_by_added, commented, parent_issue_added` etc.), but it only has events, not state. Default plan stays #6: diff stored pointer vs fetched summary; use timeline/events only to attribute *who* (actor) when needed (e.g. "was this close by a human?").
- Conditional requests: `ETag` returned (V); `If-None-Match` -> 304 for an unchanged first page is the cheap idle poll. Whether 304 is free against the primary limit: docs fetched did not say (? - widely reported as free).
- Budget: 1 list call per Product per interval (+comments only when moved). At 30 s: 120/h per Product. Fine at 5000/h; GraphQL not needed for polling.

### Webhooks (optional)
- Registration (V): repo hook `POST /hooks`; App-level webhook set at App registration. Events relevant: `issues`, `issue_comment`, `pull_request`, `check_run` (+`check_suite`), `sub_issues` (V accepted by hooks API), `issue_dependencies` (V accepted; actions `blocked_by_added|removed`, `blocking_added|removed`, D: [events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)).
- Signature ([validating deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)): header `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(raw body, secret); compare constant-time over the **raw** body bytes. Header only present if a secret is set; always set one. Also `X-GitHub-Event`, `X-GitHub-Delivery` (use as idempotency key).
- A webhook only triggers an early poll (`updatedAt` re-check); polling stays the source of truth. `capabilities.webhooks` = true when the Connection is an App with a reachable URL or the token can create hooks (Webhooks:write).

## 5. GraphQL vs REST

| Need | REST | GraphQL | Use |
|---|---|---|---|
| Sub-issue add/remove/list/parent | yes (V) | `addSubIssue`, `removeSubIssue`, `Issue.subIssues`, `parent` (V) | REST |
| Dependencies add/remove/list | yes (V) | `addBlockedBy`, `removeBlockedBy`, `Issue.blockedBy/blocking` (V) | REST |
| Counts in one read | `sub_issues_summary`, `issue_dependencies_summary` on issue JSON (V) | `subIssuesSummary` | REST |
| Close with reason | `state_reason` (V) | `closeIssue(stateReason)` | REST |
| Projects v2 | none | required | GraphQL, only if added |
| Assign a `Bot` actor | REST login-based (403 for non-installed bots, V) | `replaceActorsForAssignable` / `suggestedActors` (D) | REST first; GraphQL probe in the Claim test |
| Batch read of many issues + relations | N calls | one query with `rateLimit{cost}` | GraphQL only as optimisation |

Gaps (REST): sub-issue/dependency endpoints need the **global `id`** (extra lookup if only `number` is known; the issue JSON has both); no "create issue as child" in one call (create then link: 2 calls, not atomic); no REST for Projects v2 items on user-owned projects.

## Surprises
1. Sub-issue/dependency endpoints take global `id`, not `number`.
2. Relation changes never bump `updated_at` (poll blind spot).
3. `since` without `Z` and `since` near the epoch silently return 0.
4. Issues list is eventually consistent (seconds).
5. Invalid assignee logins are silently dropped (201).
6. Bots: assignee 403 for non-installed bots; Check-runs write is App-only (403 for user token).
7. Add-labels auto-creates labels; remove-label of absent label is 404.
8. `state_reason` accepts `duplicate`; plain close defaults to `completed`; reopen sets `reopened`.

## Open risks
- App `[bot]` as issue assignee unverified (needs a registered App); fallback = label/machine-user mirror of the Postgres claim.
- Minimal permission set unverified (sandbox runs used a broad user token); re-run section 2 with an installation token after the App exists.
- Projects v2 access for Apps on user-owned projects unverified; `updated_at` behaviour on project changes untested.
- Secondary rate limits (content creation 80/min) when Runs create many comments/commits; need backoff on 403/429 with `Retry-After`.
- Private-repo attachment links invisible to Product users without repo access.
- Self-hosted Bauherr: manifest flow needs a browser-reachable callback; GitHub Enterprise Server differs in API version (sub-issues/dependencies availability unverified).
