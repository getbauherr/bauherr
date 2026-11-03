# Pasted images (media)

Screenshots from the Intake chat are stored once and linked as images in the forge Ticket body (`## Screenshots`).

**Attaching.** In New request and the embed widget, paste (Ctrl/Cmd+V), drop or pick (+ button) a screenshot; it shows as a chip with a remove button. The browser checks type and size against the limits below (served by `POST /intake/api/media-limits`) and shows an inline error; the server checks again and stays authoritative.

**Storage.** By default files live in the compose volume `bauherr-media` (`/data/media`, shared by `app`, `worker`, `poller`). Set these and restart to use any S3-compatible bucket instead (AWS, MinIO, Hetzner, R2); unset them to go back. No code change. New files go to the configured store; reads try S3 first (when configured) and fall back to the local volume, so files written under the other store stay readable. Files written to S3 need the S3 variables kept to be read.

| Variable | Meaning |
|---|---|
| `MEDIA_S3_BUCKET` | Bucket name; setting it turns S3 on |
| `MEDIA_S3_ENDPOINT` | Endpoint URL (empty for AWS) |
| `MEDIA_S3_REGION` | Region, default `auto` |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | Keys; `..._FILE` variants read a mounted secret |

**Limits.** `MEDIA_MAX_BYTES` (default 5 MiB) and `MEDIA_MAX_PER_SESSION` (default 5). Types are fixed to png, jpeg and webp, checked by magic bytes; EXIF and text metadata are stripped.

**Links.** A Ticket body links `${PUBLIC_URL}/m/<id>/<sig>.<ext>`: public, unguessable (HMAC-SHA256 of the id with `PAYLOAD_SECRET`), non-expiring, served from either store, so the bucket stays private. Anyone holding a link can view the image, including viewers of a private repo (the forge proxy caches it); screenshots can show private data. `PUBLIC_URL` must be an https URL the forge can reach. Rotating `PAYLOAD_SECRET` invalidates every existing link.

Rows from before this change keep their base64 data and keep working; there is no backfill.
