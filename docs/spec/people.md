# People: roles and assignments

One auth collection, `bauherren`, holds every account. Related pages: Addressed checkpoints, Forge channel and guard test.

## Roles

`role` is `admin`, `bauherr` or `product-owner`. Rank: Admin, then Bauherr, then Product owner. `lib/people.ts` has `rank`, `isBauherr`, which is Admin or Bauherr, and `isProductOwner`.

- Only an Admin sets or changes a role. The first account becomes Admin. The last Admin cannot be demoted or removed. Nobody changes their own role.
- Only an Admin deletes, which archives, or restores a Workspace. `archiveWorkspace` and `restoreWorkspace` are in `lib/workspace-delete.ts`. Any Admin may restore within 14 days. Then `purgeWorkspace` deletes its rows for good and only unlinks people. The last live Workspace cannot be deleted.

## Assignment

A Product owner has `assignments: [{ workspace, scope: 'workspace' | 'products', products: [] }]`.

- `scope` is explicit. An empty `products` list under `products` grants nothing, never "all".
- At most one assignment per Workspace. Its Products must belong to that Workspace.
- A hook keeps the tenant plugin's `tenants` equal to the Workspaces of the assignments, whatever a caller or SSO sends.
- Bauherren keep `tenants` and have no assignments. Changing a Product owner into a Bauherr clears them. The other way starts with none.
- Deleting a Product removes it from assignments.
- `assignmentOf(user, workspace)` and `canSeeProduct(user, product)` read this. A Bauherr or Admin sees every Product of their Workspaces.

## What a Product owner sees

One module filters everything, `lib/people.ts`: `assignmentOf`, `canSeeProduct`, `productScope`, `productsVisibleTo`, `requestsVisibleTo` and `mediaVisibleTo`. Anything outside the assignment answers 404, never 403. That covers Product B of the same Workspace, another Workspace and a missing id.

| Area | Open to a Product owner |
|---|---|
| Home | Requests, `homeOf`. Sidebar: Inbox with the count of what asks them, Requests with the draft count, Profile. No dock, chat button, Workspace switcher, command palette, presence, Release notes or Settings. They work in the first Workspace they are assigned in |
| Requests `/requests` | Four sections: Needs you, Drafts, In the factory, Done. Sent requests of assigned Products plus their own drafts. No By column, no drag |
| Writing | The request conversation: `/requests/new`, `/requests/<id>`. Same shell as a Bauherr, model shown as a plain label, no cost chip. No Report a problem |
| Request and Ticket `/requests/[id]`, `/tickets/[id]` | Request card, plain-word path and timeline, "waits for", proof, release note, comments |
| Media | `/intake/api/media/[id]` when `mediaVisibleTo` holds. An open draft's files only to its author |
| API | The artifact route and the media route. No Payload REST collection except their own account |

- "Needs you" shows only the requester's steps on their own request, as status text without a button. A checkpoint addressed to them is decided in the Inbox or on the Ticket page.
- An urgent request proposes the fast lane with `bauherr:expedite-proposed`. Only an Admin's goes straight onto it, `canPutOnFastLane`.
- Proof comes from `/api/tickets/[id]/artifacts/[artifactId]`, images through the signed-in route.
- The reduced Ticket page hides Runs, steps, worklog, cost, tokens, models, executors, agent names, the plan and its decisions, budgets, settings, the workflow editor and Insights. It also hides the Agent team, the Bauherr's Inbox and forge issue links. `loadOwnerTicket` and `loadRequest` read no Runs.
- The comment stream lists forge comments without the factory's own markers and escalations. There is no question card on the reduced page.
- Review artifacts are never behind a public link. The signed link `/m/<id>/<sig>` is handed out only for images that end up in forge text. No page of a Product owner links to it.
- The docked chat is closed. `chatWho` refuses them, so every `/api/chat/*` route answers 403.
- Open server actions: sign-in, sign-out, and the request conversation's `requestState`, `requestChange`, `requestSubmit` and `discardIntake`, each only for their own request of an assigned Product. Open routes: `POST /api/requests/<id>/turn`, 404 for any request that is not theirs, and `POST /api/requests/media`.
- Report a problem and `postDockComment` stay closed.

Not yet: commenting from the Ticket page, and forge comments counting as decisions. A decision is theirs only where a checkpoint is addressed to them.

## Closed by default

Besides the table above, a Product owner reaches only `/login`, sign-out, the OIDC flow, `/settings/profile`, `/api/health`, the signed image link `/m/<id>/<sig>` and their own account over Payload REST.

- `/settings` redirects to the profile.
- The account allows read, and update of `password` and `uiPrefs` only. The account's `beforeValidate` hook refuses any other changed field. No API key can be enabled for them.
- `requireBauherr` answers a Product owner with 404 and `getBauherr` returns null. Every page, action and route built on them is closed without a check at the call site. `getPerson` and `requirePerson` serve the few places open to both.
- The intake `actor`, `/mcp`, which also needs an agent key, `callTool` and `chatWho` refuse a Product owner.
- Every collection has an explicit `access`. `col()` defaults each operation to `bauherrOnly`, which is Admin or Bauherr, and the multi-tenant plugin still narrows to their Workspaces. A collection overrides single operations.
- Payload's `payload-*` collections are closed the same way by `closeBuiltIns` in `payload.config.ts`, except `payload-preferences`, which Payload keys to the user.
- `OIDC_PRODUCT_OWNER_ROLE` maps a role claim value to `product-owner`. The admin claim wins. Unset maps nobody.
- A new SSO Product owner has no assignment and sees nothing. A re-sync never raises a Product owner to `bauherr`, `resyncRole`. SSO never touches assignments.
- `OIDC_BAUHERR_ROLE` makes a mapped role mandatory for sign-in. See `docs/auth.md`.

## Addressed checkpoints

Every human checkpoint asks the Bauherr or the Product owner. Rules, defaults and `mayDecide` are on Addressed checkpoints.

## Not built yet

A Product tab "Product owners".
