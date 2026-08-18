# Design-language round — handoff

> **HISTORICAL (2026-08-16).** The fresh pass this fed happened the same day: the one-system
> sweep (see `DESIGN-SWEEP.md`, the living handoff). Everything here was either ruled (see
> `../features/design-lang/LEDGER.md`) or became sweep work. **§1's adoption census
> CLOSED 2026-08-16** — the numbers reached their targets (final table in `DESIGN-SWEEP.md`
> "CLOSED") and the living gate is now `apps/web/src/design-guard.test.ts`: hard zeros on
> the deleted vocabulary, ratcheted baselines on the tails, run by `vp test`.
> Do not cite the rest for new work.

Raw findings for a fresh pass. Numbers and patterns only; verdicts deliberately omitted.

**Code**: `apps/web/src/design-lang/proto/{specimen,scopes}.css|tsx`, route `/design-lang?scope=a…h`.
Byte-identical markup under every scope; only `data-scope` changes. Throwaway.
**Prior positions**: `docs/design/COLOR-ROLES.md` (deleted 2026-08-17, git history only), `docs/design/SURFACE-PHILOSOPHY.md` (untracked).

---

## 1 · Adoption census (2026-08-16)

| | count |
|---|---|
| `ui/verb`, `ui/chip`, `ui/switcher` shipping consumers | **0** (only `design-system.tsx` + `family/proto/variant-e.tsx`) |
| `ui/button` importers / JSX sites | 22 / 64 |
| raw `<button>` outside `components/ui` | **137** across 37 files |
| `<Verb>` sites: prototype / exhibit / production | 20 / 4 / 12 |
| forked `Verb` components | **5** (`family.tsx:185`, `families.tsx:283` drops required `reason`, +3 variants) |
| `useVerb()` call sites | 2 — **11 files still hand-roll the busy/error idiom it was written to delete** |
| host writes carrying ceremony | ~1 in 3 of ~18 trigger points |
| confirmation dialogs in production | **0** |
| `--act-*`/`--st-*` role tokens outside styles.css | 6 files (2 are the doc page + the prototype) |
| raw palette refs outside `components/ui` | ~640 across 50 files |
| `ui/dialog` product importers | 0 (`takeoffs.tsx:805` hand-rolls a modal: no focus trap, no Esc, no `role`) |

**Duplication clusters**: 15 status pills · 12 raw `<table>` in 9 files (incl. `families.tsx`, which
already imports `MasterTable`) · 7 card/panel · 6 progress bars · 6 empty states · 5 segmented
controls · 4 dashed-seam marks · 3 "pea is working".

**Name collisions**: `Chip` exported from `#/components/ui/chip` (`tone`) and `#/ops/primitives`
(`hue`); `Column<Row>` from `#/components/master-table/model` and `#/ops/primitives`.

**Second system**: `ops/primitives.tsx` — 82 `Chip`, 83 `MonoNote`, 69 `EmptyState`, 44 `OpSection`
call sites. Assigns hue *taxonomically* (cheap→green, mutate→clay). No verb primitive.

---

## 2 · Token facts

- **4 indistinguishable blues** in light (all `#005695`): `--act-commit`, `--pe-blue` (37 files),
  `--primary` (34 sites outside ui/), `--cat-blue`. Diverge only in dark. `--ring` is the same blue.
- **`--st-done` == `--st-proposal` in dark** (`#82d0a8`). `--user` == `--st-warn` in light (`#847a67`).
- **Alarm spent 4 ways**: `--destructive` (19 files), `--st-drift` (3), `var(--clay)` (33), `text-cat-clay` (34).
- **`--pe-blue` carries 11+ meanings on `/family`** across both vocabularies.
- **`dashed` meanings**: 4 on `/family`, 6 on `/takeoffs`, +2 elsewhere. Reserved for "seam" in `ui/chip.tsx:37`.
- **No type scale**: 381 arbitrary `text-[Npx]` across 12 sizes vs 6 Tailwind steps.
- **Radius**: 94 hardcoded `rounded-[2px]` duplicate 93 `rounded-[var(--radius)]`; 44 real violations.
- **No spacing, shadow, or motion tokens exist.**
- Shipping inversions: derived renders **kiln** (6 files; doc says lichen); staged renders **lichen**
  (no role exists); commit buttons in `settings.tsx`/`parameter-links.tsx` are `--cat-green`;
  `settings.tsx` renders pea proposals in `--pe-blue`.

**Measured** (scope g, proposal wash vs its grid ground): light 1.12 → 1.22 after moving the grid
from `--card` to `--muted`; dark 1.42. `--st-proposal` is `#72c6a2`, a light mint — near-no-op as a
tint on warm paper at the strength dark needs.

---

## 3 · The state vocabulary the code produces

~48 distinct states. They fall in **two lanes** that the current vocabulary conflates:

**Value states (~30)** — override · formula-resolved · formula-unresolved · missing · readOnly ·
null-vs-empty · excluded(+reason) · unavailable · proposal-open · staged · staged-delete · review
mark · confidence hi/lo · sources · ambiguous-grounding · fresh/stale/unverified/null · drift ·
planHash-drift · r10-mismatch · target implicit/pinned/ambiguous/no-match · lane · world phase

**Action outcomes (~18)** — busy · **dropped** (`use-verb.ts:34`, invisible today) · error · receipt ·
refused · partial-success-failures-stay-staged · advisory · unhomed · 7 host-issue kinds · thread claim

Collapsed to 5 candidate axes during the round: **origin · freshness · agreement · staging · capability**.

**Model knows / UI discards**: `proposal.confidence` (never read by `/family`'s matrix) ·
`trichotomy.ts:26` `by: "pea"|"human"` (reviewer never reads) · `excludedReason` · `observedAtUnixMs`
· `HostIssue.retryHint`.

**Marks the model can't justify**: `ValueDiff` renders unknown-prior and unchanged identically
(`changed = from != null && from !== to`) · `≈ cached` returns "cached" whenever `horizonRank` is null
· `FamilySnapshot.versionToken` is `String(dataUpdatedAt)` compared against a document revision, so
the live lane's freshness check **can never return fresh**.

---

## 4 · What each scope varied

| | varied |
|---|---|
| a | COLOR-ROLES as written. 2 vocabularies. No expression for capability; 3 write radii collapse to one blue |
| b | hue = state only + 1 commit exception; rail = capability; underline **style** = freshness; outcomes get own lane |
| c | as b, no interactive hue at all; commit = filled neutral (contrast, not colour) |
| d | control — every line copied from a shipping call site |
| e | one axis / one slot, never shared. corner=origin, underline=freshness, ink=agreement, dot=staging, rail=capability |
| f | mode-invariant accents (declared once, verified 0 drift across theme flip); brutalist typographic glyphs; whole-cell proposal |
| g | old palette restored; ground moved `--card`→`--muted`; 3 nav variants (back/forward/out); lucide icons; capability icon replaces rail |
| h | type as axis: italic=locked(+grey), bold=unsaved, normal=other. Underline = one squiggle family ranked by colour. No icons in cells |

Specimen carries 12 rows covering all 5 axes (incl. one row with two marks at once), 10 verbs by
blast radius, 7 outcomes.

---

## 5 · User's stated reactions (raw)

- Round-1 vocabulary "sounded good on paper", was written in a session focused on other things;
  "not enough thought and tuning".
- Wants: hue serving **one, maybe two** vocabularies; a **separate parallel palette** for
  charts/graphs/taxonomy.
- Blast radius as an orthogonal descriptor, not more hues.
- Prefers the **light palette**, but finds **dark contrast** better. Asked to fix via **background
  tokens**, not by changing accents. Rejected the mode-invariant accent set (f) as muddy.
- "Optimize for what they will see and understand immediately" — cross-software motif meaning over
  internal consistency.
- Squiggly → drift/"this is wrong". Plain underline → citation. Later: freshness should also be
  *some version of* squiggly.
- Proposal: promote to **whole cell** — dotted outline + semi-transparent fill + corner fold + save
  square, all green. Plain save square (user's) a different colour.
- Locked/uneditable → **always greyed italic**. Proposed type axis: bold=unsaved, italic=can't
  change, normal=other.
- Nav needs **three** variants: forward, backward, out. `open in RHVAC` = nav; `sync to .r10` =
  write:external.
- Verbs: solid blue for all `write:*`; colour+icon slot for page/read/stage; agent = pea green.
- Outcome treatment from **a/c** (coloured mono text) preferred over b/e's left bars. Vertical bars
  not understood.
- Typographic glyphs "look really bad" → lucide icons. Icons in **verbs and outcomes** work; icons
  **in table cells** break ergonomics when values run long.
- Round-2 styling judged "a big regression… unpolished and rudimentary"; concepts closer than execution.
- Currently unhappy with where h landed.

---

## 6 · Open

- Enforcement lever unchosen. Available: **oxlint with JS-plugin support** (custom rule = 1 plugin +
  1 rule line; `.vscode` already runs `source.fixAll.oxc` on save) · Vite+ native `staged` hook (no
  new deps) · **the web app has no CI at all** — only workflow is dotnet `Compile.yml`.
  Note: TS `required` props do not survive forking — `verb.tsx:29` requires `reason`, and one of 5
  forks dropped it.
- Precedent for a token check: `host-typegen --check` byte-compares generated output. Tokens are
  hand-authored in `styles.css`; nothing consumes them programmatically.
- `/design-system` role settled as spec-first, then catalogue, then lint fixture; variants compete
  elsewhere and get promoted in. Tiering (canon / candidate / retired) proposed, not built.
- `ops/primitives` disposition undecided.
- Untouched: `--viz-*` parallel palette, the `effect` descriptor's final value set, the two-lane
  split (value marks vs outcome receipts) as a component boundary.
