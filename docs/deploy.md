# Staging and the Release button

The Release button on `/releases` starts your own deploy pipeline. This page lists what that pipeline and the two workflows need. Bauherr does not run your servers.

## The flow

1. Every merge to the default branch runs `staging.yml`. It builds a test build of the image, smoke-tests it and pushes it with a `sha-` tag.
2. The `deploy` job triggers your deploy pipeline with that image and waits until the staging site reports the commit.
3. The Release button starts `deploy.yml` on the release tag. It waits for the version image, triggers your deploy pipeline with the version and waits until production reports it.

Only the newest merge is deployed to staging. An older run stops.

## What you provide

| Name | Kind | Value |
|---|---|---|
| `DEPLOY_TRIGGER_URL` | repository variable | the endpoint that starts your deploy pipeline |
| `DEPLOY_TRIGGER_TOKEN` | repository secret | its trigger token |
| `BAUHERR_STAGING_URL` | repository variable | address of the staging site |
| `BAUHERR_PRODUCTION_URL` | repository variable | address of the production site |

Create the environments `staging` and `production`. Add approval rules to `production` if you want a second look.

Your pipeline gets a form post with the token, `BAUHERR_TARGET` (`staging` or `production`) and either `BAUHERR_IMAGE` or `BAUHERR_VERSION`. A GitLab pipeline trigger works as it is. It should deploy the image, and for production back up the databases first.

## What the sites must report

`/api/health` answers `ok`, `version`, `commit` and `startedAt`. The workflow polls it until the value matches and the process started after the trigger. A redeploy of the same commit that does not restart the container waits until the timeout.

## Staging runs a fake forge

The staging image is a test build with a fake forge. It never writes to your repositories.
