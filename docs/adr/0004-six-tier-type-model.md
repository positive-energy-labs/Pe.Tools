# ADR 0004 — Six-tier type model for the web surfaces

Date: 2026-08-16. Status: accepted, codified in `apps/web/src/styles.css`.

## Context

A type census over `apps/web` (163 files, ~32.3k LOC) found 666 type spends across **18 rendered
sizes**, 90.2% of them inside a 9–12.5px band — differences no reader can perceive but every call
site had to choose. `tele` was overridden at 118 of 240 call sites, section heads had forked seven
ways, and `lang.css` declared 10 mono font-families against 2 sans, making mono the *unmarked*
default and voiding the signal the mono law assigns it.

Every route, every feature's UI, and `/design-system` itself spend type, so this is not a
design-lang-local decision: it constrains what any feature's route is allowed to write.

## Decision

Three axes are separated, and call sites never name a pixel:

- **tier** — `t-caption` 10/1.4 · `t-label` 11/1.3 · `t-value` 12/1.4 · `t-prose` 13/1.55 ·
  `t-title` 16/1.25 · `t-display` 40/1.1. A tier carries its own leading; no call site names one.
- **face** — `font-sans` is the default, `face-mono` is the marked case. Mono is permitted on
  identifiers, paths, keys, counts, measured numbers, timestamps, durations, states and outcome
  receipts; forbidden on verbs/buttons, labels, section heads, empty states, help prose and
  refusal explanations. `tele` survives as `face-mono` only.
- **case** — `t-upper`. A section head is `t-label` + `t-upper`: a case, not a size. That retires
  `section-label`, `tele-label`-as-header, `.dl-verb-group-title` and four hand-rolled variants.

Weight is carried by the utilities, not by call sites: **bold** = unsaved on data surfaces, or
emphasis inside real `t-prose` — never chrome emphasis. **Semibold** = `t-title` / `t-upper` heads
only. `t-upper` is declared after `face-mono` on purpose so head tracking wins; heads are sans, and
`face-mono` never composes with `t-upper`.

A standing minimize-options bias applies: adding a tier requires the same bar as adding a state word.

## Consequences

- Any new size, leading, or weight written at a call site is a defect, not a variation.
- Enforcement is owed: an oxlint JS-plugin rule vs a staged hook vs CI is unruled; until then the
  law is convention plus review.
- Sweep order follows the census: `/design-system` first (9 distinct sizes — it cannot be the
  ratchet while it is the worst offender), then the three files carrying 58% of title prose.
- Known outliers to fold in: `components/ui/badge.tsx` renders at `text-[0.7rem]` (11.2px), a size
  that appears nowhere else; the display face is named three ways under two token names.
