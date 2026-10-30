# Sign-in

Password login (Payload, email + password) works on a fresh clone with no configuration. OIDC single sign-on is additive: set `OIDC_ISSUER` and a "Sign in with …" button appears on `/login` under the password form.

## OIDC

Authorization code flow with PKCE, `state` and `nonce`; endpoints come from discovery at the issuer (use an `https` issuer). The redirect URI is `${PUBLIC_URL}/auth/oidc/callback`.

| Env | Default | Meaning |
|---|---|---|
| `OIDC_ISSUER` | unset | Issuer URL, e.g. `https://sso.example.com/realms/acme`. Enables the feature. |
| `OIDC_CLIENT_ID` | | Client id |
| `OIDC_CLIENT_SECRET` / `OIDC_CLIENT_SECRET_FILE` | | Client secret (confidential client); the file form wins |
| `OIDC_ROLE_CLAIM` | `realm_access.roles` | Dot path into the ID token or userinfo |
| `OIDC_ADMIN_ROLE` | `bauherr-admin` | Value in the role claim that grants role `admin`; anyone else is `bauherr` |
| `OIDC_WORKSPACE_CLAIM` | `groups` | Claim whose values are Workspace slugs (a leading `/` is stripped) |
| `OIDC_DISPLAY_NAME` | issuer host | Label on the button |

Sign-in rules:

- The email claim is required and `email_verified` must not be `false`.
- First sign-in creates the Bauherr by email (the very first Bauherr of an installation is always `admin`). Every later sign-in resyncs `role` and Workspace memberships (`tenants`) from the claims; slugs that match no Workspace are ignored.
- The Bauherr stores `oidcSubject` (`issuer|sub`) and `oidcSynced`. An email already bound to a different subject is refused.
- Session: cookie `bauherr-session`, an HS256 token signed with `PAYLOAD_SECRET` (7 days, HttpOnly, `Secure` when `PUBLIC_URL` is https), accepted by the UI, `/admin` and the REST API through the Payload auth strategy `oidc`. Sign out clears it.
- Failures redirect to `/login?error=oidc`; tokens and claims are never logged.

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
