# Docs

This folder is for repo-level docs that do not belong inside a package-local `AGENTS.md`, `_DEV.md`, or `_GOALS.md`.

## Structure

- `ENVIRONMENT.md`
  - canonical build, verify, test, package, install, publish, and environment recovery runbook
- `features/`
  - cross-package feature docs
  - use when one conceptual capability spans multiple packages or ownership seams
  - feature folders usually contain concise `_GOALS.md` and `_DEV.md`
- `context/`
  - temporary or semi-temporary saved context
  - research notes, agent handoffs, mini summaries, and other material worth keeping for later reference

## Rules

- Prefer local package docs first.
- Use `AGENTS.md` for durable behavior, workflow cautions, and shared language.
- Use `_DEV.md` for conceptual orientation and `_GOALS.md` for intent.
- Use `docs/features/` for durable cross-package feature intent and concise feature-level conceptual documentation.
- Use `docs/context/` for saved context, not as a permanent architecture source of truth.
- Keep repo-level docs few, current, and clearly named.
- Delete or migrate stale docs instead of letting the folder become a dump.
