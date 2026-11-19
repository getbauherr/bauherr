# Knowledge editor, PR watcher and layered knowledge store

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `/knowledge` searched and read the documents agents use. `/knowledge/edit` edited one markdown file in the browser. Settings > Knowledge set the Workspace's Knowledge repo and connection.
- Save opened a pull request, never a direct commit: branch `bauherr/edit-<ts>`, title `Edit <path>`, a `Co-authored-by` trailer for the editor, one file per PR, markdown only. If the file's sha had moved, save returned `stale` with a line diff instead.
- The watcher `watch-knowledge-prs` (every minute) merged an edit PR by squash only when: the PR head starts with `bauherr/edit-`, head and base repo are the Knowledge repo, the head sha equals the recorded one, exactly one file changed and it is the recorded path, checks are green (red adds `bauherr:checks-failed` once, pending waits).
- On a merge conflict it re-created the PR on the current head with a three-way merge (`merge3`, `bauherr:rebased`, old PR closed `bauherr:superseded`). A second conflict or a failed merge got a `bauherr:needs-you` comment with the diff. After a merge it ran `resync`.
- Three layers in the index: `core` (the pack: `.md`, `.yaml`, `.ts`, `.sh`), `workspace` (the Knowledge repo: markdown and `products/<slug>/feature-map.yaml`) and `product` (each Product repo's `README.md` and `docs/**/*.md`, logical name `repo-docs/<path>`). A more specific layer hid the same logical path of a less specific one.
- `resync` (job `resync-knowledge`, every minute) re-indexed a source only when its key changed (core pack hash, or `repo@commit`), split files into chunks of at most 3200 characters at headings (fences respected), backed off 10 minutes after a failure and deleted chunks of sources that were gone.

## The requirement behind it

- Agents and people must work from the same documents, with citations of source, path, heading and commit (#150, #151).
- A person must be able to fix a document without a git client, with review and checks still applying (#152).
- A Product's own docs must count as knowledge (#232).

## Where the code is

- `apps/server/src/lib/knowledge.ts` (210: `chunk`, `layerOf`, `resync`, `search`, `read`, `documents`, `readDocument`), `knowledge-edit.ts` (191: `loadDocument`, `saveDocument`, `lineDiff`, `merge3`, `watchKnowledgePrs`), `skill-distill.ts` (226, a Knowledge-repo PR writer for skills, not part of this page).
- Routes: `apps/server/src/app/(app)/(shell)/knowledge/` (page, edit/page), `(shell)/settings/knowledge/page.tsx`.
- UI: `components/KnowledgeEditor.tsx` (30), `components/KnowledgeRepo.tsx` (35), `app/(app)/lib/knowledge.ts` (105).
- Jobs in `apps/server/src/jobs/index.ts`: `resync-knowledge`, `watch-knowledge-prs`.
- Collections in `apps/server/src/collections.ts`: `knowledge_chunks` (source, layer, path, logical, product, heading, text, commit), `human_touches` (kind `knowledge-edit`, status, prNumber, headSha, baseContent), workspace fields `knowledgeRepo`, `knowledgeConnection`, `knowledgeIndexed`.
- MCP tools `read_knowledge`, `search_knowledge`; the same two as chat tools.
- Tests in `apps/server/tests/`: `knowledge.test.ts`, `knowledge-edit.test.ts`, `knowledge-page.test.ts`.
- Docs: `docs/ui.md` (`/knowledge`); no separate spec page found (`docs/spec/workflow.md` mentions `SECURITY-CONTEXT.md` in the Knowledge repo, `docs/spec/history.md` the per-Product `workflow.yaml` overlay).

## Why it was cut

In the lean core the repository's own docs and `AGENTS.md` are the knowledge, changed by ordinary pull requests; an in-product editor is not needed. The `knowledge_chunks` store and its full-text `search` function are kept.

## What a module on the new core needs

- Core contracts: the forge writer for branch, file and PR (the watcher and `saveDocument` must go through it, not call GitHub), the mirror for PR files, checks and comments, and the event log for "merged by watcher". The `human_touches` row would become an event or module state.
- Liftable almost unchanged: `lineDiff`, `merge3`, the merge guards in `watchKnowledgePrs` (head prefix, repo equality, sha equality, single file, markdown only), `chunk`, `layerOf`. `search` and `knowledge_chunks` stay in the core.
- To design again: where the layers come from, since the repo docs and `AGENTS.md` are now the main source and the pack, Workspace repo and `workspaces.knowledge*` fields may be gone; who may edit (the old route used `requireBauherr`); how a merge feeds back into the index.
- Traps: the guard on head sha stops a push after approval from merging unseen text; a rebase conflict must end in a human flag, not a loop (`REBASED` marker); tree listings can be truncated by GitHub (the old code logged a warning and indexed what it got); two Products may share a repo with the Knowledge repo, which is excluded from product targets; the index must drop sources that were removed.
