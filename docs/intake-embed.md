# Embed the Intake widget

A Product's users can report a problem from your own site. The answers become a Ticket in Triage.

1. Open Settings > Workspace > Products > your Product > **Widget**. Enter a name and the origins that may embed the widget, such as `https://shop.example.com`. Optionally set the sessions per hour; empty means 20. Choose **Add widget**. The script tag is shown once and only a hash is stored. **Revoke** ends a token at once.
2. Paste the tag before `</body>` on the site:

```html
<script src="https://BAUHERR_HOST/intake/widget.js" data-token="bemb_..."></script>
```

Requests from any other origin, or with a revoked token, get 403. A token is bound to its Product and capped at 20 new sessions per hour. `/intake-embed-test.html?token=bemb_...` is a host page for trying it on the Bauherr origin itself. Add that origin to the token first.

## Behaviour

- `/intake/widget.js` is a static bundle built from `apps/server/src/app/intake/widget` by `pnpm --filter server build:widget`, part of `dev` and `build`. It renders in a shadow root. `tests/widget-size.test.ts` keeps it within 250 KB gzip.
- The widget resumes an open interview after a page load. The session id stays in the browser's localStorage per token.
- After the 6th question the assistant only acknowledges and updates the draft. The visitor can keep adding detail, and **Submit request** stays available.
- A session accepts at most 40 visitor messages.
