# Context Docs

Use `docs/context/` for saved context that is useful to keep around for a while but is not stable enough, local enough, or important enough to become package docs or feature docs.

Good fits:
- agent handoffs
- research summaries on API shapes or feature feasibility
- temporary planning context or todo lists
- investigation notes worth revisiting later

Bad fits:
- durable package guidance
- canonical feature intent
- the only source of truth for current architecture

## Expectations

- Treat this folder as disposable context, not permanent documentation.
- Prefer concise filenames that say what the note is about.
- Delete or promote files once their value becomes clear.
  - promote to `docs/features/` if the note becomes durable feature-level guidance
  - promote to local package docs if it becomes local operational knowledge
