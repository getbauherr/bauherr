# Embed the Intake widget

A Product's users can report a problem from your own site; the answers become a Ticket in Triage.

1. Settings > Products > **Embed tokens**: enter a name and the origins that may embed the widget (e.g. `https://shop.example.com`), then **Create token**. The script tag is shown once; only a hash is stored. **Revoke** ends a token at once.
2. Paste the tag before `</body>` on the site:

```html
<script src="https://BAUHERR_HOST/intake/widget.js" data-token="bemb_..."></script>
```

Requests from any other origin, or with a revoked token, get 403. A token is bound to its Product and capped at 20 new sessions per hour. `/intake-embed-test.html?token=bemb_...` is a host page for trying it on the Bauherr origin itself (add that origin to the token).

The widget resumes an open interview after a page load (the session id is kept in the browser's localStorage per token).
