---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it per the `docs` skill's research rule: the feature dir (`docs/features/<name>/`) if feature-scoped, else `docs/research/`. Link it from the feature ledger where relevant.

## Reading third-party source

When the question needs a repo's actual source (not just its docs), **clone it** — grep over a local checkout beats web reading for anything non-trivial, and repeated research on large repos is only cheap if the clone persists. The stable home is `~/source/.explore/<repo>` (machine-local, never inside a project repo, never `.artifacts/`). Before reading an existing clone, **always sync it first** (`git pull` / `git fetch`) — a stale clone silently answers questions about a version that no longer exists.
