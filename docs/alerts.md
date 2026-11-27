# Production alerts

A Product can turn alerts from your monitoring into tickets. The setting is off by default and belongs to one Product.

## Turn it on

1. Open the Product in Settings and find "Production alerts".
2. Switch on "Create tickets from production alerts" and save.
3. Create the secret. It is shown once. Replacing it stops the old one at once.
4. Copy the webhook URL: `https://<your instance>/api/alerts/<product id>`.

The Product must be active and have a repository. While the setting is off, the URL answers 404.

## Connect Grafana

Create a contact point of type Webhook:

| Field | Value |
|---|---|
| URL | the webhook URL |
| HTTP method | POST |
| Authorization header, scheme | `Bearer` |
| Authorization header, credentials | the secret |

Add the contact point to a notification policy for the alerts you want as tickets. Alertmanager works the same way: use `http_config.authorization` with the secret as credentials.

Any other sender can post `{"title": "...", "description": "...", "severity": "critical", "fingerprint": "...", "url": "https://..."}`. Add `"status": "resolved"` to report recovery.

## What happens

- Every alert becomes a bug in Intake. A critical alert goes ahead of the others, a high one comes second.
- An alert with the same fingerprint as an open ticket adds a comment to that ticket. A resolved alert does too. A resolved alert without an open ticket is ignored.
- A fingerprint whose ticket is done opens a new ticket when it fires again.
- The alert text reaches the agents as reference data. The ticket says so, and the text is escaped like any outside reporter's text.
- A change that follows from an alert always needs your approval of the Brief.

## Limits

- A wrong or missing secret, an unknown Product and a Product with alerts off all answer 404.
- A Product accepts 30 alerts a minute (each alert in a request counts), then answers 429. Grafana retries later.
- A Product opens at most 20 new tickets an hour. Further new alerts comment on one "alert storm" ticket.
- A request is at most 256 KB, read as a stream, and carries at most 20 alerts.
- The limit counts per process.
