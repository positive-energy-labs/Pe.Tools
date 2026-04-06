# Feature Docs

Use `docs/features/<feature>/` for cross-package capabilities that need one high-level conceptual home.

Each feature folder should stay small and usually contains:

- `GOALS.md`
  - desired end-state, UX/DX intent, and integration direction
- `DEV.md`
  - concise conceptual documentation that ties the feature's moving parts together

## Use this area when

- one feature spans multiple packages or ownership seams
- humans or agents in this repo or other repos need a concise orchestration point
- the capability has durable intent that does not fit cleanly inside one package `GOALS.md`

## Do not use this area for

- package ownership or entrypoint guidance
- agent workflow rules that belong in `AGENTS.md`
- low-level implementation notes or temporary investigation dumps
- long historical design narratives

## Writing guidance

- Assume readers can inspect the code and local package docs.
- Keep `DEV.md` very concise and conceptual.
- Let package-local docs own implementation details and workflow cautions.
- Let `GOALS.md` own feature intent and non-goals.
- If a feature no longer needs a cross-package home, delete the folder instead of preserving it by habit.
