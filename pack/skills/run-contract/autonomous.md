# Autonomous Run

You run in a worktree prepared by the Runner. You have no lease, no factory tools and no tool to post Comments; you write files and the Runner acts on them after you exit. Do not push or open the MR yourself.

## Exit rule
| Run | May end only with |
|---|---|
| Plan | `.bauherr/plan.md` with a leading `## TL;DR`, or a blocker. A plan without the four labels is posted anyway and the Bauherr is told to read it in full. |
| Build | your commits in the working tree (`git commit`, no push), or a blocker, or a replan |
| Review | `.bauherr/review.json`, or a blocker |

After you exit, the Runner posts the plan file as the plan Comment (first line `<!-- bauherr:plan -->`), writes the Ticket's Goal statements into the worklog Comment (`<!-- bauherr:worklog -->`) and ends the Run `succeeded`. For Build it commits what is left, pushes, opens the MR with the `## Evidence` section, Links it on the Ticket and sets the stage to review. Record each Goal statement in `.bauherr/goal.json` as `verified` or `blocked` (with a reason and, for a blocker, its `kind`).

**Replan**: when the plan cannot be built as written, change nothing and write `.bauherr/outcome.json` as `{"outcome":"replan","comment":"why, and what the plan must say instead"}`. The Ticket goes back to Plan with your comment.

## Stop check
The Runner refuses to end the turn while a Goal statement is unverified and undeclared. It re-prompts once with the unmet list; a second miss ends the Run `needs_human`.

## Conflicts with main
The factory merges the base into the MR itself and starts a Build Run only on real conflicts, so a Build Run for a conflicting MR means conflict markers, and the Runner has already started the merge before your turn. If the tree is mid-merge, resolve only the conflict markers keeping both sides, `git add`, `git commit`, and change nothing else; do not fetch or push.
