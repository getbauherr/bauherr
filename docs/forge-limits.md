# GitHub outages and rate limits

When GitHub or GitLab does not answer, or refuses calls at its rate limit, the factory pauses. It does not fail runs or ask you.

## What happens

- Short faults retry on their own, with growing waits. A server error or a lost connection is retried. A wait of more than five minutes counts as a limit.
- At a limit or an outage the Connection is held. The poller skips it. Run starts and merges wait.
- Work parked this way resumes after the hold ends. Questions, closes, status comments and reopens that were due are sent then.
- A run that dies on a forge fault goes back to the queue. It is not counted as failed.

## Where you see it

- A banner on the Factory view for each held Connection, for example "GitHub limit reached, resumes at 14:05 UTC". It disappears when the hold ends.
- Settings, Health shows the budget per Connection, for example "4321 of 5000 calls left", and when it resets.
- Below 20 % of the budget left, the poller runs at most every five minutes.

## What to do

Nothing. Check Health if the banner stays up for long, or if the limit is too low for the number of Products.
