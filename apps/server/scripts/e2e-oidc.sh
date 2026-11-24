#!/usr/bin/env bash
# Start the fake OIDC provider (:4010) and a second server (:3001) with OIDC on, for the @oidc specs (E2E_OIDC=http://localhost:3001).
# The first server (:3000) stays password-only. Usage (repo root, server on :3000 up and seeded, BAUHERR_TEST_BUILD=1 build): apps/server/scripts/e2e-oidc.sh
set -euo pipefail

OIDC_CLIENT_SECRET=$(openssl rand -hex 16)
export OIDC_CLIENT_SECRET
export OIDC_ISSUER=http://localhost:4010 OIDC_CLIENT_ID=bauherr PUBLIC_URL=http://localhost:3001
export OIDC_ROLE_CLAIM=resource_access.bauherr.roles OIDC_PRODUCT_OWNER_ROLE=product-owner BAUHERR_E2E_OIDC_INSECURE=1

pnpm --filter server exec tsx e2e/fake-oidc.ts >> apps/server/e2e/app.log 2>&1 &
pnpm --filter server exec next start -p 3001 >> apps/server/e2e/app.log 2>&1 &
curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null http://localhost:4010/.well-known/openid-configuration
curl --fail --silent --retry 60 --retry-delay 2 --retry-connrefused -o /dev/null http://localhost:3001/login
