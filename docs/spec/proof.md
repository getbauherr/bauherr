# Review artifacts

The person who accepts or approves production reads proof, not code. A review artifact is typed proof attached to a Ticket, in the table `artifacts`.

| Type | Content |
|---|---|
| `image` | A before and after pair is two images with `pair` |
| `recording` | Screen recording |
| `preview` | A URL to try |
| `transcript` | A terminal session |
| `sample` | Request and response, or an output |
| `report` | A test or contract summary |

- Each has a title, the acceptance `criterion` it proves, the Product `rule` it satisfies and the commit `sha`.
- Files live in the media store. Text up to 200 KB sits in the row. Images up to 5 MB, recordings up to 25 MB, type checked by content.
- A Product declares proof in Settings > Products > Checks & merging > Proof for review, stored as `reviewChecks.artifacts`. Per rule: name, path globs, kind and a command that writes into `.bauherr/artifacts/` and lists files in `.bauherr/artifacts.json`.
- An image rule can ask for the picture before the change. The command then also runs in a clean checkout of the base with `BAUHERR_ARTIFACT_PAIR=before`.
- Session Runs attach with `attach_artifact`. The Runner runs matching rules after the last edit, with the egress guard and no forge credentials, and collects the manifest.

## Enforcement

- A rule whose globs match a changed path needs an artifact with that rule on the MR head. Otherwise `request_review` and the Runner's pre-review are refused, naming the rule and command.
- A rule may name a path set, `pathSet`, instead of globs and require a before and after pair per variant, `pairs`. Only `kind=image` artifacts count whose `pair` is `before` or `after`, whose title starts with the variant name, see `pack/rules/evidence.md`, and which belong to that rule on the MR head. The refusal lists each missing `<variant> before|after`.
- Every Product with a `ui` path set gets the rule `UI change: before/after` with pairs `light-desktop` and `dark-desktop` and no command. The agent attaches the pictures. The rule needs no stored configuration. Settings shows it read-only and refuses a save that changes its kind, path set or pairs.
- A Product without a `ui` set gets no rule. A rule naming an undeclared or empty set matches nothing.
- The only way out is the Evidence line `No artifact: <rule>: <reason>`. A line without a reason does not count. It shows as "No proof for `<rule>`: `<reason>`".
- One proof table, What was asked, Proof and Try it, appears on the Ticket page, the Inbox cards for staging and production, and the chat confirm card. A criterion without proof reads "No proof".
- Files are served only to members of the Ticket's Workspace at `/api/tickets/<id>/artifacts/<artifact>`, never by public link.
