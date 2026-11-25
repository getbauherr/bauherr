# Sign-in

Password login with email and password works on a fresh clone with no configuration. OIDC single sign-on is additive: set `OIDC_ISSUER` to an https URL and a "Sign in with …" button appears on `/login`.

## Password sign-in limits

`withLoginLock` in `src/lib/login-lock.ts` queues `payload.login` per lowercased email, because Payload writes the whole `sessions` array and parallel sign-ins would drop one session.

- It is an in-process queue, not a database lock. A waiting sign-in holds no pooled connection. Several replicas would need a shared lock.
- At most `MAX_LOGIN_WAITERS` sign-ins of one account wait or run at once. The default is 5. A further one is refused with `LoginBusy` and the generic wrong-password error.
- `POST /api/bauherren/login`, also used by the `/admin` form, goes through the same queue and cap. GraphQL is off.
- Per-IP limit: after `LOGIN_IP_MAX_ATTEMPTS` **failed** sign-ins from one IP within `IP_WINDOW_MS`, that IP is refused before the queue. REST answers 429. Successful sign-ins do not count. The defaults are 10 and 1 minute.
- Both limits are per process. A non-integer `LOGIN_IP_MAX_ATTEMPTS` or `TRUSTED_PROXY_HOPS` fails at boot.
- The Postgres pool waits at most `DATABASE_POOL_TIMEOUT_MS` for a connection, default 10000.

### Client IP

The IP comes from `x-forwarded-for`. `TRUSTED_PROXY_HOPS`, default 1, must equal the number of proxies that append to the header: Traefik alone is 1, a CDN in front of Traefik is 2. The IP is the entry that many places from the right. Entries to its left are client-supplied and ignored.

A request with fewer entries did not pass the proxy chain. It draws from the shared key `ip:unverified`, so forging the header gives no fresh budget. The server logs `login IP key: request had N x-forwarded-for entries, TRUSTED_PROXY_HOPS=M; check the proxy chain` at most every 10 minutes.

- In production publish only the proxy, never the app port. A request on the app port takes the shared path and can fill its bucket for everyone.
- The dev `compose.yaml` publishes the app on `:3000` without a proxy. Use `TRUSTED_PROXY_HOPS=0` there, see #432. It ignores the header, turns the IP limit off with a boot warning and keeps the per-account cap.
- Without any proxy there is no trustworthy IP limit. A client that sends `x-forwarded-for` picks its own key under the default.

OIDC sign-in does not use Payload sessions.

## OIDC

Authorization code flow with PKCE, `state` and `nonce`. Endpoints come from discovery at the issuer. The redirect URI is `${PUBLIC_URL}/auth/oidc/callback`.

| Env | Default | Meaning |
|---|---|---|
| `OIDC_ISSUER` | unset | Issuer URL, https, e.g. `https://sso.example.com/realms/acme` |
| `OIDC_CLIENT_ID` | | Client id |
| `OIDC_CLIENT_SECRET` / `OIDC_CLIENT_SECRET_FILE` | | Client secret of a confidential client; the file wins |
| `OIDC_ROLE_CLAIM` | `realm_access.roles` | Dot path into the ID token or userinfo |
| `OIDC_ADMIN_ROLE` | `bauherr-admin` | Claim value that grants role `admin`. Anyone else is `bauherr`, or `product-owner` with `OIDC_PRODUCT_OWNER_ROLE`. |
| `OIDC_PRODUCT_OWNER_ROLE` | unset | Claim value that grants `product-owner`, see `docs/spec/people.md`. Admin wins on first sign-in; an existing Product owner is never raised by a later sign-in. |
| `OIDC_BAUHERR_ROLE` | unset | Claim value that grants `bauherr`. When set, a sign-in with none of the three values is refused. Unset: every realm user gets `bauherr`. |
| `OIDC_WORKSPACE_CLAIM` | `groups` | Claim of Workspace slugs; a leading `/` is stripped |
| `OIDC_DISPLAY_NAME` | issuer host | Label on the button |

The feature is on only when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, a client secret and `PUBLIC_URL` are all set. Otherwise the button is hidden, the routes return 404, and one warning names the missing variable, never its value.

### Sign-in rules

- `email` is required and `email_verified` must be exactly `true`. ID token claims win over userinfo. A userinfo failure fails the login.
- Lookup is by `oidcSubject`, `<issuer>|<sub>`. A match logs in and resyncs.
- No match but a Bauherr with that email exists: refused, no automatic linking (`/login?error=oidc-link`). Nothing found: a Bauherr is created. The role comes from the claim only; the first SSO user is not made `admin`.
- Resync writes `role` only if the role claim is present, and `tenants` only if the workspace claim is present. Slugs matching no Workspace are ignored.
- A resync never raises a Product owner to `bauherr`, and never touches `assignments`. A new SSO Product owner starts with none and lands on `/requests`.
- Linking: an Admin sets `oidcSubject` to `<issuer>|<id>` under Settings, Bauherren. In Keycloak the id is Users, the user, ID. It is unique.

### Sessions

- Cookie `bauherr-session`: an HS256 token signed with `PAYLOAD_SECRET`, claims `id`, `v`, `typ=bauherr-session`, `aud=bauherr`, HttpOnly, `Secure` under https. The UI, `/admin` with `BAUHERR_ENABLE_ADMIN=1` and the REST API accept it.
- Sessions last 14 days, set by `SESSION_TTL_S`, for SSO and password sign-in. Logout ends them at once.
- The token carries `sessionVersion`. It is rejected if the version differs, the account is locked or the Bauherr is gone.
- Signing out of the UI increments `sessionVersion` and ends every SSO session of that Bauherr. Logging out of `/admin` does not.
- A locked account's session works again when the lock ends or an Admin unlocks it under Settings, People.

### Required role

With `OIDC_BAUHERR_ROLE` set, a user without a mapped role is refused before anything is written (`/login?error=oidc-role`). An existing SSO account that no longer maps is refused too, and its `sessionVersion` is incremented. Password login stays open, so an Admin who forgets to grant themselves the role is not locked out.

### Errors

- `/login?error=oidc` for any failure, `oidc-link` for a required link, `oidc-role` for no mapped role.
- Server logs carry `oidc_login_failed`, `oidc_callback_failed` or `oidc_login_refused` with the error name and message. Tokens, claims and emails are never logged.

## Keycloak example

1. Client: type OpenID Connect, client authentication on, standard flow on, valid redirect URI `https://bauherr.example.com/auth/oidc/callback`.
2. Realm roles: create `bauherr-admin` and assign it to admins. The default `roles` client scope maps realm roles to `realm_access.roles`. Turn on "Add to ID token" or "Add to userinfo" for that mapper.
3. Groups: create a group per Workspace named by its slug. Add a "Group Membership" mapper to the client scope with token claim name `groups`.
4. Optional, to restrict who may sign in: create client roles `admin`, `bauherr` and `product-owner` on the client and assign them to users. Add a "User Client Role" mapper with client `bauherr`, multivalued, claim name `resource_access.bauherr.roles`, added to the ID token. Give yourself `admin` first.
5. Add to `.env` next to `compose.yaml`:

```bash
OIDC_ISSUER=https://sso.example.com/realms/acme
OIDC_CLIENT_ID=bauherr
OIDC_CLIENT_SECRET=...
OIDC_ROLE_CLAIM=resource_access.bauherr.roles
OIDC_ADMIN_ROLE=admin
OIDC_PRODUCT_OWNER_ROLE=product-owner
OIDC_BAUHERR_ROLE=bauherr
```

Omit the last four lines if you skipped step 4.
