# Forge channel and guard test

## Forge channel

A gate label or an answers comment, `bauherr:decisions`, written on the forge counts as a decision. The author's forge login must be linked to a person who may decide it. The account's `githubLogin` holds the login, a GitLab username too. `lib/forge-channel.ts` is the one place that decides.

### Who counts

- A Bauherr or Admin of the Ticket's Workspace, always. Admins count in every Workspace.
- A Product owner only when assigned to the Ticket's Product and the checkpoint asks the Product owner. For answers that means the decision row's `for:`, else the checkpoint's `by`. `askedFor` applies the fallback: a checkpoint for the Product owner of a Product without one asks the Bauherr.
- A Product owner of Product A has no say on Product B. The fast lane is the Bauherr's.
- Logins match case-insensitively. One login belongs to one account, with case ignored, and a duplicate is refused on save.

### Labels

`lib/gate-labels.ts` looks up the actor of the latest `labeled` event as above. Anyone else's label is removed, with one `label-rejected` comment naming the reason. The marker is per label and time. The factory's own credential still needs the recorded touch.

### Answers comments

- `decisionComments` is the one read of a Ticket's comments for decisions. Every page, sweep and action uses it.
- Untrusted answers comments are left out, so `answersOf`, `openCritical` and the pages see only what counts.
- A Product owner's comment keeps only the answers and added rows that ask the Product owner.
- The sweeps and the poller, `notify`, post one `answers-ignored` comment per ignored comment, marker keyed on the comment id, saying why. A page render never writes.

### The factory's own comments

The Ticket page, chat and MCP all write answers through `postDecisions`. The forge's author field is compared with the credential's login, `whoami`, cached 5 minutes per Connection, or a `[bot]` author for an App token. Comment text is never used.

The factory edits only its own comment in place. Where the newest counted comment is a person's, it posts the merged answers as a newer comment.

Residual risk: an agent session under the factory's own credential is the factory to this check. The same holds for labels, see [Gates](gates.md#gate-labels).

### Gate owners

- `products.gateOwners` is gone. Who is assigned and mentioned at a gate is derived: the linked logins of the Workspace's Bauherren and Admins, plus the assigned Product owners where a checkpoint asks them.
- Migration `20261112_170000_forge_channel` keeps logins that match an account and moves the others to `products.unlinkedGateOwners`.
- Settings > Health lists, per Product, old logins without an account, with "link the login on the person's profile". It also says when a Workspace with a forge has no Bauherr or Admin with a linked login. Decisions by label or comment then count for nobody, and the Ticket page still works.

### Linking

The profile edits one's own login, a Product owner's too, with `saveOwnLogin`. That is the only account field a Product owner may change besides password and preferences. An Admin edits anyone's under People, which lists who has none.

## Guard test

`apps/server/tests/product-owner-guard.test.ts` puts every page, route handler, server action, chat tool and collection into exactly one list:

| List | Meaning | Exercised as a Product owner |
|---|---|---|
| `BAUHERR_*` | A Product owner is refused | Pages rendered, actions called, routes fetched, collections per operation, MCP tools. Each must answer 404, 401 or 403, or refuse |
| `PO_*` | Open to a Product owner, each with its reason | Anything that shows or changes data is tried against Product B of the same Workspace, another Workspace and a colleague's draft. Each must answer 404 |

The sets are globbed from the source. A new page, route, action, chat tool or collection fails the partition test until someone decides. `tests/product-owner-view.test.ts` covers what a Product owner does see.

To open something to a Product owner:

1. Change its rule. Use `requirePerson`, `currentPersonWorkspace` or a narrower check. Never loosen `requireBauherr` or `acting`.
2. Filter its data in `lib/people.ts`.
3. Move it to the `PO_*` list with the reason.
4. Add its Product B check.
5. Update this page.
