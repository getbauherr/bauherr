# Embed the Intake widget

A Product's users can report a problem from your own site; the answers become a Ticket in Triage.

1. Settings > Products > **Embed tokens**: enter a name and the origins that may embed the widget (e.g. `https://shop.example.com`), then **Create token**. The script tag is shown once; only a hash is stored. **Revoke** ends a token at once.
2. Paste the tag before `</body>` on the site:

```html
<script src="https://BAUHERR_HOST/intake/widget.js" data-token="bemb_..."></script>
```

Requests from any other origin, or with a revoked token, get 403. A token is bound to its Product and capped at 20 new sessions per hour. `/intake-embed-test.html?token=bemb_...` is a host page for trying it on the Bauherr origin itself (add that origin to the token).

`/intake/widget.js` is a static bundle built from `apps/server/src/app/intake/widget` (`pnpm --filter server build:widget`, part of `dev` and `build`). It holds React and assistant-ui and renders in a shadow root; `tests/widget-size.test.ts` keeps it within 250 KB gzip.
