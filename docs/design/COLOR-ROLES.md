# Color roles — the layer between palette and surface

Decided 2026-08-16 (clean-room grill). The palette (`styles.css` base + `cat-*`) stays as it
is; MEANING is assigned only by the role tokens in `styles.css` (`--act-*`, `--st-*`).
Reconsidering a color is a one-line edit to a role alias — never a sweep.

## Law 0 — two vocabularies, never mixed

*Interaction* roles say what pressing does. *State* roles say what a fact is. A hue serves one
vocabulary only. Components consume roles, not palette; raw `--pe-blue`/`--cat-*` outside
`components/ui` and deliberately-visual canvases (anatomy SVG, doc-pane sheet) is a review
finding.

## Interaction roles

| Role | Meaning | Treatment |
|---|---|---|
| `--act-commit` | writes beyond the page: save, apply, materialize | pe-blue border+text — the ONLY interactive blue |
| act (default) | safe verb, page-scoped: capture-into-draft, parse, **bind**, **accept** | neutral border `--line-2`; hover strengthens to `--act-hover` — never blue |
| nav | goes somewhere / back | foreground text, underline affordance, no border |
| mode / choice | exclusive switch — of a VIEW or of a small data value; same treatment either way | active = FILLED `--secondary` (mist); selection is a fill, never a colour |
| focus ring | a11y | stays blue (`--ring`) — transient, unconfusable at rest |

Two rulings worth saying out loud (2026-08-16):
- **Accept is act, not commit.** Accepting a proposal STAGES it; nothing has left the page. It
  is coherent — and intended — that a proposal surface carries zero commit affordance: the
  only commit is the verb that leaves the page (save / apply / materialize). Bind likewise
  rewrites only the document/draft, so it is act.
- **Focus/selection is a fill.** Anything answering "where am I / what is lit" — focused rows,
  lit citation blocks, lit sheet regions, selected constituents, active mode — is `--secondary`
  mist (plus a `--st-meta` hairline where an edge is needed), NEVER a colour. A lit grounding
  citation is focus, not state: `--st-ground` stays a quiet underline; the light is mist.

Components: `ui/verb.tsx` (`tone: commit | act | nav`, `reason` required), `ui/switcher.tsx`
(mode), `ui/chip.tsx` (status facts; `dashed` = seam/unproven, that border style is reserved).

## State roles

| Token | Meaning | Note |
|---|---|---|
| `--st-proposal` | pea's voice — proposals, agent marks | pe-green: pea's established identity in chat; proposals are NEVER blue |
| `--st-drift` | the model disagrees | clay — the only alarm; nothing else may wear it |
| `--st-warn` | stale, unsaved, unverified | kiln — caution, not alarm |
| `--st-derived` | formula-driven, computed | lichen |
| `--st-done` | landed, receipted, settled | cat-green |
| `--st-meta` | neutral machine-measured fact | slate |
| `--st-ground` | grounding citation | neutral hairline — deliberately spends no colour |

## Outside both vocabularies

- **Identity/brand garnish** (route wordmarks, masthead tones) is neither interaction nor
  state — it uses `muted-foreground` or a deliberate identity treatment, never a state tone.
- **Visual canvases** (anatomy SVG ink, doc-pane sheet) keep their own resting palette; but
  their *highlight* strokes obey the focus-is-mist and proposal-is-green laws — a drawing may
  not wear commit blue at rest.

## Shape law

Role is legible by position and shape before colour (colour-blind-safe, budget stays small):
corner triangle = proposal · bottom-left dot = unsaved · dotted underline = grounding
(neutral) or drift (clay outranks) · rail dot = locator. A mark never changes corner or shape
between surfaces.

## Enforcement

- `/design-system` carries the roles section — the living contract, with counter-examples.
- Review check (grep-grade): raw palette vars outside `components/ui` + visual canvases.
- Migration: clean-room variant-e first (proving ground); whole-app sweep is a bounded
  mechanical mission once the vocabulary survives it.
