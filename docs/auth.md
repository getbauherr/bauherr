# Sign-in

Password login (Payload, email + password) works on a fresh clone with no configuration. OIDC single sign-on is additive: set `OIDC_ISSUER` (https) and a "Sign in with …" button appears on `/login` under the password form.

Password sign-ins are serialised per account: `withLoginLock` (`src/lib/login-lock.ts`) queues `payload.login` per lowercased email in the server process, because Payload writes the whole `sessions` array and parallel sign-ins would drop one session. It is an in-process queue, not a database lock: a waiting sign-in holds no pooled connection (a lock held across `payload.login` deadlocked the pool, since a wrong password writes `loginAttempts` outside the transaction). It serialises within one app process, which is the current deployment; several replicas would need a shared lock that holds no connection while waiting. At most `MAX_LOGIN_WAITERS` (5) sign-ins of one account wait or run at once; a further one is refused at once (`LoginBusy`, nothing queued, no DB work) and the login page shows the same generic error as for a wrong password, so it does not reveal whether the account exists. The REST sign-in `POST /api/bauherren/login` (also used by the `/admin` form) is a collection endpoint that replaces Payload's built-in one and goes through the same queue and cap; GraphQL is off (`graphQL.disable`), so there is no second login path. Both entry points also share a per-IP limit: at most `MAX_IP_ATTEMPTS` (10) sign-in attempts per `IP_WINDOW_MS` (1 minute) per client IP, checked before the queue so a limited IP never takes a slot (same generic error, 429 on REST). `LOGIN_IP_MAX_ATTEMPTS` overrides the 10 (e2e raises it: every worker signs in from one IP). Like the queue it is per process. The IP is the last hop of `x-forwarded-for`, the address the nearest proxy appended (earlier hops are client-supplied). Behind a proxy that appends (Traefik does) it is the real client. Without a proxy Next only fills the header when it is absent, so a client that sends it can dodge the IP limit (the per-account cap still holds), and every client behind one NAT or Docker port proxy shares a bucket. The Postgres pool waits at most `DATABASE_POOL_TIMEOUT_MS` (default 10000) for a connection, so an exhausted pool fails the request instead of hanging the app (see `docs/first-run.md` "Database connections"). OIDC sign-in does not use Payload sessions.

## OIDC

Authorization code flow with PKCE, `state` and `nonce`; endpoints come from discovery at the issuer (use an `https` issuer). The redirect URI is `${PUBLIC_URL}/auth/oidc/callback`.

| Env | Default | Meaning |
|---|---|---|
| `OIDC_ISSUER` | unset | Issuer URL, must be https, e.g. `https://sso.example.com/realms/acme`. |
| `OIDC_CLIENT_ID` | | Client id |
| `OIDC_CLIENT_SECRET` / `OIDC_CLIENT_SECRET_FILE` | | Client secret (confidential client); the file form wins |
| `OIDC_ROLE_CLAIM` | `realm_access.roles` | Dot path into the ID token or userinfo |
| `OIDC_ADMIN_ROLE` | `bauherr-admin` | Value in the role claim that grants role `admin`; anyone else is `bauherr` |
| `OIDC_WORKSPACE_CLAIM` | `groups` | Claim whose values are Workspace slugs (a leading `/` is stripped) |
| `OIDC_DISPLAY_NAME` | issuer host | Label on the button |

The feature is on only when `OIDC_ISSUER` (https), `OIDC_CLIENT_ID`, a client secret and `PUBLIC_URL` are all set (`PUBLIC_URL` builds the redirect URI and cookie flags). Otherwise the button is hidden, the routes return 404, and one warning naming the missing variable (never its value) is logged at first use.

Sign-in rules:

- `email` is required and `email_verified` must be exactly `true`; missing or non-boolean fails the login. Claims from the ID token win over userinfo; a userinfo failure fails the login.
- Lookup is by `oidcSubject` (`<issuer>|<sub>`) first. A match logs in and resyncs. No match but a Bauherr with that email (case-insensitive) exists: refused, no automatic linking (`/login?error=oidc-link`). Nothing found: a Bauherr is created with the lowercased email. SSO creates are never made `admin` for being first; the role comes from the claim only.
- Resync writes `role` only when the role claim is present, and `tenants` only when the workspace claim is present; an absent claim keeps the stored value. Slugs matching no Workspace are ignored.
- Linking policy: an Admin edits the Bauherr under Settings, Bauherren and sets `oidcSubject` to `<issuer>|<id>`. In Keycloak the id is Users, the user, ID. The value is unique across Bauherren.
- Session: cookie `bauherr-session`, an HS256 token signed with `PAYLOAD_SECRET` (claims `id`, `v`, `typ=bauherr-session`, `aud=bauherr`, 14 days, HttpOnly, `Secure` when `PUBLIC_URL` is https), accepted by the UI, `/admin` (only when `BAUHERR_ENABLE_ADMIN=1`) and the REST API through the Payload auth strategy `oidc`.
- Lifetime: sessions last 14 days (`SESSION_TTL_S`) for SSO and password sign-in (the Bauherren `auth.tokenExpiration` uses the same constant); logout ends them at once.
- Revocation: the token carries the Bauherr's `sessionVersion`. It is rejected when the version differs, the account is locked, or the Bauherr no longer exists. Signing out of the UI increments `sessionVersion`, which ends every SSO session of that Bauherr. Logging out of `/admin` (when enabled) does not bump it. A locked account's session stops working until the lock ends or an Admin unlocks it (Settings, People).
- Errors: `/login?error=oidc` (any failure) and `/login?error=oidc-link` (link required). Server logs carry `oidc_login_failed` or `oidc_callback_failed` plus the error name and message only; tokens, claims and emails are never logged.

## Keycloak example

1. Client: type OpenID Connect, client authentication on (confidential), standard flow on, valid redirect URI `https://bauherr.example.com/auth/oidc/callback`.
2. Realm roles: create `bauherr-admin` and assign it to admins. The default `roles` client scope maps realm roles to `realm_access.roles`; make sure "Add to ID token" is on for that mapper (or "Add to userinfo").
3. Groups: create a group per Workspace named by its slug (`acme` or `/acme`). Add a "Group Membership" mapper to the client scope with token claim name `groups`, full group path on or off, added to ID token or userinfo.
4. Compose, in `.env` next to `compose.yaml`:

```bash
OIDC_ISSUER=https://sso.example.com/realms/acme
OIDC_CLIENT_ID=bauherr
OIDC_CLIENT_SECRET=...
```
