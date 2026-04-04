# Security

## Intended Public Surface

This repo is meant to be public as source code.

The intended public runtime surface is the static site in `apps/public-site`. It should be deployed as static files only.

## Dev-Only Surfaces

`apps/playground` is a local development app. Its Vite config contains local middleware for:

- reading local review data
- reading and writing local human-scoreboard artifacts

Do not deploy the playground dev server as a public service.

## Secrets

- keep credentials only in `.env.local`
- never commit `.env.local`
- if a credential is exposed, rotate it immediately
- benchmark artifacts may include prompts, raw model responses, and local run metadata; review before sharing

## Dependency and Repo Hygiene

- run `pnpm test` and `pnpm build` before publishing changes
- prefer exporting fresh public-site data with `pnpm export-public-site` before a deploy
- do not commit local scratch scripts, logs, Finder metadata, or generated caches

## Reporting

If you find a security issue in the repo, report it privately to the maintainer before opening a public issue.
