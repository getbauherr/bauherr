# Pasted images (media)

Screenshots from the Intake chat are stored once and linked as images in the forge Ticket body under `## Screenshots`.

## Attaching

The dock's request conversation and the embed widget accept a screenshot by paste with Ctrl/Cmd+V, drop or the attach button. Dock uploads go to `/api/requests/media`. The dock shows a thumbnail with a remove button. The widget shows a chip.

- The widget checks type and size against the limits below, served by `POST /intake/api/media-limits`, and shows an inline error.
- The dock checks the type. The server rejects an oversize image through `POST /api/chat/media`, shown on the thumbnail. The server is authoritative.
- In a request thread the images of a message become the request's session screenshots, at most `MEDIA_MAX_PER_SESSION`, as in the widget.

## Storage

By default files live in the compose volume `bauherr-media` at `/data/media`, shared by `app`, `worker` and `poller`. To use an S3-compatible bucket instead, such as AWS, MinIO, Hetzner or R2, set these variables and restart. Unset them to go back.

| Variable | Meaning |
|---|---|
| `MEDIA_S3_BUCKET` | Bucket name; setting it turns S3 on |
| `MEDIA_S3_ENDPOINT` | Endpoint URL, empty for AWS |
| `MEDIA_S3_REGION` | Region, default `auto` |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | Keys. The `_FILE` variants read a mounted secret. |

New files go to the configured store. Reads try S3 first, then the local volume, so files written under the other store stay readable. Files written to S3 need the S3 variables kept to be read.

## Limits

- `MEDIA_MAX_BYTES`, default 5 MiB.
- `MEDIA_MAX_PER_SESSION`, default 5.
- Types are png, jpeg and webp only, checked by magic bytes. EXIF and text metadata are stripped.

## Links

A Ticket body links `${PUBLIC_URL}/m/<id>/<sig>.<ext>`. The link is public, unguessable, non-expiring and served from either store, so the bucket stays private. The signature is an HMAC-SHA256 of the id with `PAYLOAD_SECRET`.

- Anyone holding a link can view the image, including viewers of a private repo through the forge proxy cache. Screenshots can show private data.
- `PUBLIC_URL` must be an https URL the forge can reach.
- Rotating `PAYLOAD_SECRET` invalidates every existing link.

Older rows keep their base64 data and keep working. There is no backfill.
