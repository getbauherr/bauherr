# People: roles and assignments

One auth collection, `bauherren`, holds every account. `role` is `admin`, `bauherr` or `product-owner`. Rank: Admin > Bauherr > Product owner (`lib/people.ts`: `rank`, `isBauherr` = Admin or Bauherr, `isProductOwner`). Only an Admin sets or changes a role. The first account becomes Admin; the last Admin cannot be demoted or removed; nobody changes their own role.

## Assignment

A Product owner has `assignments: [{ workspace, scope: 'workspace' | 'products', products: [] }]`. `scope` is explicit: an empty `products` list under `products` grants nothing, never "all". At most one assignment per Workspace; its Products must belong to that Workspace. A hook keeps the tenant plugin's `tenants` equal to the Workspaces of the assignments (whatever a caller or an SSO sync sends). Bauherren keep `tenants` as before and have no assignments (changing a Product owner into a Bauherr clears them; the other way starts with none). Deleting a Product removes it from assignments. `assignmentOf(user, workspace)` and `canSeeProduct(user, product)` read this; a Bauherr or Admin sees every Product of their Workspaces.

## Closed by default

A Product owner reaches nothing except `/login`, sign-out, the OIDC flow, `/settings/profile` (`/settings` redirects there), `/api/health`, the public signed image link `/m/<id>/<sig>`, and their own account over Payload REST (read; update of `password` and `uiPrefs` only: any other changed field is refused by the account's `beforeValidate` hook, no API key can be enabled for them).

- `requireBauherr` answers a Product owner with a 404 and `getBauherr` returns null, so every page, server action and route built on them is closed without a check at the call site. `getPerson` / `requirePerson` are for the few places open to both.
- `chatWho`, the intake `actor`, `/mcp` (also behind an agent key) and `callTool` refuse a Product owner.
- Every collection has an explicit `access`: `col()` defaults every operation to `bauherrOnly` (Admin or Bauherr; the multi-tenant plugin still narrows to their Workspaces), a collection overrides single operations. Payload's own `payload-*` collections are closed the same way in `payload.config.ts` (`closeBuiltIns`), except `payload-preferences`, which Payload keys to the user. A Workspace member can no longer write any collection a Product owner could not; Bauherren and Admins lose nothing the app used.
- OIDC: `OIDC_PRODUCT_OWNER_ROLE` maps a role claim value to `product-owner` (the admin claim wins; unset = nobody is mapped). A new SSO Product owner has no assignment and sees nothing. A re-sync never raises a Product owner to `bauherr` (`resyncRole`); assignments are never touched by SSO. See `docs/auth.md`.

## The guard test and how to open something

`apps/server/tests/product-owner-guard.test.ts` enumerates every collection (per operation, real local-API calls with access control on and a Product owner), every page under `app/(app)` (rendered with a Product owner's session, expected 404), every exported server action (called as a Product owner, expected 404), every route handler under `app/` (called with the session, expected 401/403/404) and every MCP tool (expected refusal), and fails when one is reachable and not in an allow-list inside the test (`OPEN_PAGES`, `OPEN_ROUTES`, `OPEN_ACTIONS`, `OPEN_TOOLS`, `COLLECTIONS`). The file lists are globbed from the source, so a new page, route, action or collection fails the test until someone decides. To open something to a Product owner: change its rule (use `requirePerson` / a narrower check, never loosen `requireBauherr`), add it to the allow-list with the reason, filter its data by `canSeeProduct`, and update this page.

## Not built yet (slices 2 to 4)

- What a Product owner sees: Requests, a reduced Ticket page, Inbox, the chat dock, media of assigned Products, a Product tab "Product owners".
- Addressed checkpoints: `by: bauherr | product-owner` in the factory file, `tickets.needsBy`, `mayDecide`, decision rows `for:`, the editor select.
- Forge channel: a gate label or answers comment counts only from a forge account linked to a Bauherr or an assigned Product owner; `products.gateOwners` becomes a derived set.
