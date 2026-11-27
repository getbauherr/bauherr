# Auto-accept and epics

A Product can let the factory accept low-risk Results itself. The setting is off by default.

## Turn it on

Open the Product in Settings, section Gates. Switch on "Accept low-risk Results by themselves". Set the send-back threshold. The default is 10 %. Only an Admin changes it.

## When the factory accepts

All of these must hold.

- The Brief's risk is two-way: the change can be undone.
- Every criterion is met. None was dropped and none was accepted anyway.
- The required checks passed on the head. The Product needs required checks configured, or nothing is accepted.
- A visible change has all before and after pictures.
- The issue has no `bauherr:needs-owner` label.
- The ticket did not come from an outside reporter or a production alert.
- Of the tickets done in the last 30 days, the share sent back after Result is at or below the threshold. Without history nothing is accepted.

## What you see

- The activity says "Accepted by the factory" with the reasons, for example "two-way, 4/4 met, send-back 6 %". The actor is the factory, never you.
- The Inbox thread shows the same line.
- Insights counts Results accepted by the factory and how many were sent back later.

## Epics

A ticket that others are "part of" is an epic. Its Relations box lists the parts and "n of m done".

- The Result card waits until every part is Done or closed. The ticket shows "Waiting for parts".
- Auto-accept waits too. A card shown before that cannot be accepted while a part is open.
- Finishing the last part moves the epic on.
- Archiving an epic lists the open parts.
