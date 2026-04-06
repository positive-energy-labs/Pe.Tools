# Docs

This folder is for repo-level docs that do not belong inside a package-local `AGENTS.md`, `DEV.md`, or `GOALS.md`.

## Structure

- `features/`
  - cross-package feature docs
  - use when one conceptual capability spans multiple packages or ownership seams
- `context/`
  - temporary or semi-temporary saved context
  - research notes, agent handoffs, mini summaries, and other material worth keeping for later reference

## Rules

- Prefer local package docs first.
- Use `docs/features/` for durable feature intent and concise feature-level conceptual documentation.
- Use `docs/context/` for saved context, not as a permanent architecture source of truth.
- Keep repo-level docs few, current, and clearly named.
- Delete or migrate stale docs instead of letting the folder become a dump.
