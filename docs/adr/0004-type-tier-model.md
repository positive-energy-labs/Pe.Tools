# ADR 0004 — Type tier model for the web surfaces

Date: 2026-08-16, amended 2026-08-28 (six tiers to seven). Status: accepted, codified in
`apps/web/src/base.css` and projected by `apps/web/src/design-lang.css`.

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

- **tier** — `t-caption` 10/1.4 · `t-label` 11/1.4 · `t-value` 12/1.45 · `t-prose` 13/1.6 ·
  `t-title` 16/1.3 · `t-head` 24/1.2 · `t-display` 40/1.15. A tier carries its own leading; no call
  site names one.
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

`t-head` was added 2026-08-28. `t-title` 16 to `t-display` 40 left a 24px void, and three
route-level headings had landed inside it at 20, 24 and 30px. Its role is the heading that names a
whole route or workspace, one per surface; `t-title` names a region inside it.

**Owners.** `base.css` declares the size and line-height pair for every tier and the portable
`[data-pe] .t-*` classes. `design-lang.css` projects the same variables as `@utility` blocks and
declares no number of its own. Nothing else may name a type value.

A standing minimize-options bias applies: adding a tier requires the same bar as adding a state
word. The seventh tier was earned by role evidence — three headings with nowhere to sit — not by
call-site volume.

## Consequences

- Any new size, leading, or weight written at a call site is a defect, not a variation.
- Enforcement is deterministic. `tests/repo-guards/src/design-guard.test.ts` asserts a hard zero on
  raw text-size utilities (arbitrary `px` and `rem`, and the named Tailwind sizes) and on sub-10px
  type, and asserts that each tier's `.t-*` and `@utility t-*` blocks bind that tier's own size and
  line-height variables in both owners. `em` stays legal: `text-[1em]` is an instruction not to
  change size.
- The map for authors is [`../features/design-system/NORMALIZATION.md`](../features/design-system/NORMALIZATION.md).
