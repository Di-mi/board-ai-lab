# board-ai-lab

Benchmark lab for board-game agents and LLMs, with a static public site for published results.

## What Is Here

- `apps/public-site`: static React + Vite site for the public benchmark board
- `apps/playground`: local playground and review UI for development work
- `apps/benchmark-cli`: training, match-running, export, and reporting commands
- `packages/onitama-*`: Onitama engine and browser play helpers
- `packages/hive-*`: Hive engine, training, and browser play helpers

## Current Scope

- Onitama and Hive engines with test coverage
- Heuristic bot training for both games
- LLM match runners and artifact export
- Static public site branded as `Meeples & Models`
- Manual export flow for public benchmark data

## Quick Start

```bash
pnpm install
pnpm test
pnpm build
```

## Local Apps

```bash
pnpm dev
pnpm dev:public
```

- `pnpm dev` starts the local playground app
- `pnpm dev:public` starts the public site

## Benchmark Commands

```bash
pnpm train
pnpm hive-train
pnpm benchmark
pnpm llm-match
pnpm hive-llm-match
pnpm report
pnpm export-public-site
```

## Public Site Publish Flow

The public site is static-only. There is no backend and no live API in production.

1. Run fresh benchmark or LLM match jobs locally.
2. Export the public data:

```bash
pnpm export-public-site
```

3. Build the public site:

```bash
pnpm --filter @board-ai-lab/public-site build
```

4. Deploy the generated files from `apps/public-site/dist`.

The export command writes the main leaderboard payload to `apps/public-site/public/data/public-benchmarks.json` and refreshes the Hive public manifests used by the play page.

## Environment

Copy `.env.example` to `.env.local` and fill in only the values you need for local runs.

- `.env.local` is gitignored and should never be committed
- the public site does not require secrets to build
- OpenRouter credentials are only needed for live LLM match commands

## Security Notes

- `apps/public-site` is the only intended public deploy target
- `apps/playground` includes local Vite middleware for writing scoreboard data and reading local review artifacts; it is for local development only
- if you run the playground with a network host, keep it on a trusted machine and network
- benchmark artifacts can contain prompts, raw model output, and local run metadata; review them before sharing

See [SECURITY.md](./SECURITY.md) for the public-repo guidance used in this repo.
