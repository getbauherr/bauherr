---
name: pr-screenshots
description: Use in a Build Run whose plan changes paths of the Product's `ui` path set. Shoots the affected views before the first edit and after the last, in a fixed matrix, and hands them on as the before/after pair that the MR body shows as a table.
---

# PR screenshots

The person who accepts the change never reads the diff; the screenshots are how they see it. Shoot before you edit, not at review time.

## Procedure
1. **Before first.** Before the first edit, shoot each affected view on the unchanged code. Missed it: check out the base branch in a separate worktree with its own compose project and ports (never the factory's own), seed it the same way, shoot, then `down -v` and remove the worktree.
2. **Same data, same views.** Use the Product's screenshot setup (AGENTS.md; `scripts/screenshots.sh` in Bauherr). Note how the seed was made in the worklog so "after" shows the same data.
3. **Matrix.** Per view: light and dark at desktop 1280 wide, always. Phone 375 x 812 only when the plan changes layout. Set the theme explicitly (`prefers-color-scheme` alone is not enough). Crop a long page to the changed part. Default: three views at most, so the table has six rows.
4. **Names.** Title of each image: `<theme>-<size>: <view>`, e.g. `light-desktop: Settings`, `dark-desktop: Settings`. File: `<view>-<theme>-<size>-<before|after>.png`.
5. **Test data only.** Seeded users with `@example.com` addresses and dummy values. Never real tickets, emails, tokens, keys or customer names: the images are shared. Retake a shot that shows any.
6. **Artifacts, not a branch.** Never commit images or push a branch for them. Autonomous Run: write the files to `.bauherr/artifacts/` and list each in `.bauherr/artifacts.json` (`kind` `image`, `pair`, `rule` `UI change: before/after`, `criterion`). Session Run: `attach_artifact kind=image pair=before|after rule="UI change: before/after" criterion=<AC>`, made on the pushed commit.
7. **One table.** The MR body gets one table, before left and after right, one row per view, theme and size. Do not write it yourself: the Runner builds it from the titles above.

A view that cannot be shot (needs live credentials): state it in the Evidence as `No artifact: UI change: before/after: <reason>`.
