# Sign-in

Password login (Payload, email + password) works on a fresh clone with no configuration. OIDC single sign-on is additive: set `OIDC_ISSUER` (https) and a "Sign in with …" button appears on `/login` under the password form.

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
- Linking policy: an Admin opens the Bauherr in `/admin` and sets `oidcSubject` to `<issuer>|<id>`. In Keycloak the id is Users, the user, ID. The value is unique across Bauherren.
- Session: cookie `bauherr-session`, an HS256 token signed with `PAYLOAD_SECRET` (claims `id`, `v`, `typ=bauherr-session`, `aud=bauherr`, 7 days, HttpOnly, `Secure` when `PUBLIC_URL` is https), accepted by the UI, `/admin` and the REST API through the Payload auth strategy `oidc`.
- Revocation: the token carries the Bauherr's `sessionVersion`. It is rejected when the version differs, the account is locked, or the Bauherr no longer exists. Signing out of the UI increments `sessionVersion`, which ends every SSO session of that Bauherr. Logging out of `/admin` does not bump it.
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
