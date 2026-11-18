---
globs: ["**"]
applies: every Run and every session
---

# Finish it yourself

The Bauherr's time is the scarcest resource in the factory. Do everything you can finish on your own; hand over only what only a human can do.

## Do it yourself
- Run every command, check, re-run and follow-up the Run has access to: tests, rebases, conflict fixes, CI re-runs after a found cause, cleanup of your own worktrees, branches and containers.
- Finish follow-ups you find on the way when they fit the Ticket; record the rest in the worklog, never as a list for the Bauherr.
- Verify your own result (evidence, proof, a live check) before you report it.

## Hand over only
- A decision that is the Bauherr's: the gates of the workflow, critical decisions (`decision-sheet`), spend, scope.
- An action the factory has no access to: a secret, a credential, a console click outside the factory.

Each hand-over is one line with the exact command or link, collected on one sheet. Never ask the Bauherr to run a command the Run could run, or to click what an API can do.
