---
status: accepted
---
# Standardize vocabulary first; components wait for a second consumer

## Context

The web app carried four spellings of one colour role (`text-ink`, `text-foreground`, `var(--r-ink)`, `style={{color}}`; census 2026-08-27: 1235 : 93 : 717 : 340), two grammar dialects (`dl-*` classes and `@utility t-*`), no z scale, and no shared base for standalone HTML prototypes (each page invented 15–23 hex literals). The "second consumer validates an API" rule (SURFACE-PHILOSOPHY §6) was applied to tokens and grammar as well as to components, so vocabulary was never standardized and prototyping agents paid the cognitive load of choosing a dialect. The `goal/tailwind-foundation` branch normalized spellings mechanically but kept all four compiling.

Shapes considered: merge as-is (keeps four spellings); utilities as the only language (orphans HTML); components only (removes the layout freedom `triangulate` variants need); a generated token manifest (a generator for one consumer; the WPF `ThemeManager` never arrived as a second).

## Decision

- **Vocabulary and grammar are standardized before any consumer.** Roles, scales, type tiers, and composition utilities are law the moment they are ruled; the design guard pays their rent. **Components keep the second-consumer rule.**
- **One spelling.** House tokens are `--pe-*` (repo convention for "custom/house"; `--r-*` is renamed by codemod). The shadcn semantic aliases (`--background`, `bg-muted`, …) are deleted. A bare `var(--pe-*)` inside TSX is a hard zero; roles are reached only through the generated utilities. Escape hatches are not generated rather than ratcheted.
- **One grammar dialect.** Composition rules (wash, tiers, mono) are plain classes in `base.css`; `veil` is the one `@utility` because it takes `hover:`. Only rules bound to one component's DOM stay in that component's CSS.
- **`base.css` is the deep module.** A page that links it and sets `data-pe` is on-system with no other knowledge. Standalone HTML prototypes link it. Its header carries the band math and laws (restored from `design-lang.css` at `1455d25`).
- **Scales by evidence.** `z` gets four named rungs; motion gets one duration; space is the Tailwind default; elevation does not exist (depth is ground shift + hairline; `shadow-*` is a hard zero).
- **Split by job, not origin.** `components/ui/` becomes `components/mechanism/` (behaviour, no roles inside); `components/lang/` keeps meaning components with required arguments.
- **Routes compose; they do not colour.** A route file may use `lang/` components and layout utilities; a role utility in a route file is a ratchet (`routeRoleColor`, 333 at adoption) that may only fall; zero is the target. Panes and variants keep full layout freedom.
- Prototype trees (`proto*`) are internal-only and exempt from every guard; they are deleted, not maintained.

## Consequences

- The agent cheat sheet is one screen: 17 roles, 6 tiers, 4 z rungs, the laws, and the `base.css` link line. Hand-written until a second app wants the values, then generated.
- Codemods before merge: `--r-*`→`--pe-*`, shadcn alias deletion (19 aliases, 93 uses), `var(--pe-*)`→utility (717 sites), `dl-*` composition rules→`@utility`, `ui/`→`mechanism/`.
- The guard governs everything outside `proto*`; the route-only `routeArbitrary` ratchet becomes app-wide.
- A new role, tier, or rung is a ruling in `docs/features/design-system/LEDGER.md` plus a guard change in one commit; no route may invent one.
