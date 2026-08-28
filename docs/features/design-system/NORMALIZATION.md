# Design normalization map

The current map of who owns what in `apps/web`, and how to author new UI without reopening a
settled ruling. Written 2026-08-28 at the close of the normalization waves. Rulings live in
[`LEDGER.md`](LEDGER.md); standing product law lives in
[`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md); the executable law is
the `/design-system` route.

This file is the map, not the log. It says where a value lives now.

## Ownership stack

| Layer | File | Owns |
| --- | --- | --- |
| raw authority | `apps/web/src/base.css` | Every raw value, under `[data-pe]`. Colour roles, viz roles, the seven type size/line-height pairs, the three dash patterns, radius, motion, z-index. Portable `.t-*`, `.dash-*` and `.seam-border` classes consume them, so a no-Tailwind consumer needs nothing else. |
| projection | `apps/web/src/design-lang.css` | The Tailwind projection of the same variables as `@utility` blocks. It declares no number of its own. |
| grammar | `apps/web/src/components/lang/` | The semantic vocabulary: `Verb`, `Press`, `FactChip`/`VizChip`, `StateCell`, `EmptyState`, `HelpTip`, `OutcomeLine`, `ArmingStrip`, `AddressingBar`, `Section`, `Switcher`. This is the base layer. `components/ui` composites may depend on it, and four already do (`combobox`, `dialog`, `input-group`, `side-pane`, all for `Press`). |
| product | routes and feature dirs | Geometry and refinement only: sizes, spacing, panel widths, chart dimensions. No colour, no type scale, no broken-line pattern. |
| runtime | `apps/web/src/lib/token.ts` | The one runtime token indirection for inline, SVG and serialized use. `token(role)` resolves `viz-*` and `dash-*` as raw families and everything else as `--pe-*`; `dash(role)` is its typed wrapper. Prefer a semantic class when a direct utility exists, but use this shared lookup wherever the value must cross a runtime or serialization boundary. |

`styles.css` imports `base.css` then `design-lang.css`, in that order, and holds no value.

`runs/visual-law.json` names a semantic `dashRole`; `base.css` owns the only numeric pattern.
`eval/rhvac/render-zone-promotion.py` resolves `--dash-<role>` out of `base.css` with stdlib `re`
and fails fast. Reading the shared authority is not a second authority.

## Maintained scope

Every TypeScript, TSX, CSS and JSON surface under `apps/web/src` is maintained and enforced,
mounted routes and incubating variants alike. The generated `routeTree.gen.ts` is the only
exclusion. `/param-tables` is an incubating product, not a prototype exemption: it is mounted,
switches five variants on `?variant`, is front-door discoverable as `Incubating product`, and pays
every gate.

`docs/remote-factory.html` is a private disposable standalone page and is deliberately outside the
maintained set. It was not migrated and does not need to be.

## Authoring a new surface

Work down this list and stop at the first rung that holds.

1. **Use an existing semantic primitive.** A control that has earned a role already has a name in
   `components/lang`.
2. **Extend the shared owner, on the first real consumer.** If the role is system-wide, the value
   belongs in `base.css` (with its `design-lang.css` projection) or the primitive belongs in
   `components/lang`. Add it when the first real consumer arrives, not before, and give it a
   specimen on `/design-system` in the same commit.
3. **Only then write local geometry.** Anything that is not a system value stays at the call site.

### Press vs Verb vs link

- **`Verb`** is a world action. It carries a tone and a required `reason`, so a refusal explains
  itself. Export, PDF and SVG verbs are `act`; the one filled blue `commit` is reserved for the
  page-blast write.
- **`Press`** is surface machinery: dialog closes, chip removes, pane toggles, theme switch,
  segment chips. It mints no tone, so furniture never spends the scarce blue. It owns a real
  `<button>`, `type="button"`, native `disabled`, and joins the one hover law. Its `icon` prop is
  geometry.
- **A link** is navigation. Nav blue is a link's spend, never a button's.

There is no fourth option. `components/ui/button` is deleted.

### `title` vs `HelpTip`

Mechanical test: does the sentence still make sense if you delete the thing it is attached to?

- **Yes** — it orients a region. Use `HelpTip`. It portals to `document.body`, so no ancestor's
  overflow clips it, is keyboard reachable, and carries a stable `aria-describedby`.
- **No** — it is a fact about this one control. Use native `title`, one clause, aim for 60
  characters. The guard fails any `title` over 240.

### Type is tier × face × case

Seven tiers, each carrying its own leading. No call site names a size, a leading or a weight.

| Tier | Size / leading | Role |
| --- | --- | --- |
| `t-caption` | 10 / 1.4 | machine chrome; the 10px floor |
| `t-label` | 11 / 1.4 | field labels, section heads with `t-upper` |
| `t-value` | 12 / 1.45 | data, inline code |
| `t-prose` | 13 / 1.6 | reading text, empty and error states |
| `t-title` | 16 / 1.3 | a region inside a surface: pane, dialog, card |
| `t-head` | 24 / 1.2 | the heading that names a whole route or workspace, one per surface |
| `t-display` | 40 / 1.15 | the front door's hero |

**Face**: `font-sans` is the default, `face-mono` is the marked case — identifiers, paths, keys,
counts, measured numbers, timestamps, states, outcome receipts. Never on verbs, labels, heads,
empty states or help prose.

**Case**: `t-upper`. A section head is `t-label` + `t-upper` — a case, not a size.

Adding a tier takes the same bar as adding a state word. The seventh was earned by three route
headings landing in the 16 → 40 void at 20, 24 and 30px, not by counting call sites.

### Broken lines: seam, reference, void

Three roles, one authority. A broken line always comes from a named role; a raw pattern is a
guard failure.

| Role | Pattern | Means |
| --- | --- | --- |
| `seam` | `3 2` | Declared, with nothing real behind it. The one UI broken edge. |
| `reference` | `12 3 2 3` | Not part of the thing drawn; says where it is measured from. |
| `void` | `4 3` | Space where material is absent; must never read as material. |

Wear `.dash-seam` / `.dash-reference` / `.dash-void` or `.seam-border`. Read `dash(role)` only
where a serialized drawing carries no stylesheet. A commentary rail is not a seam: the
`/design-system` annotation rails dropped their dash, which reverses the earlier blessing of
exhibit chrome as a deliberate dashed spend.

## Enforcement and proof

`tests/repo-guards/src/design-guard.test.ts` is the lint. The web app has no CI, so discipline
holds by assertion. Every category is now a **direct hard zero** with path, line and match in the
failure output. The baseline file is deleted; there is no ratchet left to slacken.

The gates: retired `--r-*` tokens, shadcn semantic colour names, arbitrary PE colour utilities,
runtime PE/viz reads outside `lib/token.ts`, unprojected type tiers, dead shim tokens, bare line
tokens, retired `tele` words, hex literals outside `base.css`, sub-10px text, raw text-size
utilities, raw `<button>` outside `components/ui` + `components/lang`, `ui/button` imports, inline
`background:` shorthand in TS/TSX, unruled dashed strokes, `title` over 240 characters, and raw
numeric dash patterns in maintained JSON. Do not restate a gate in prose; it is executable.

Commands, from `source/pe-tools` (this worktree pins `node_modules/.bin/vp.ps1`):

```text
vp run @pe/repo-guards#test                    design guard + docs guard, 23 tests
vp check apps/web/src tests/repo-guards/src    0 errors; 15 pre-existing warnings
vp run @pe/web#build                           client + server build, prerender /
```

From `eval/rhvac`, the cross-language half:

```text
python -m unittest test_dash_role              7 tests
```

**Proof lanes.** Those four are source, deterministic and build evidence. They prove that a value
has one owner. They do not prove that a surface reads correctly. Hover, focus, portal placement,
overflow and dash legibility are browser claims and need a browser lane. State the lane; a green
guard is not a rendering claim.

## Product signals

What the waves taught, beyond the counts.

- **A missing rung is found by role, not by volume.** 24 of 44 off-tier sites were `text-sm`, and
  reading them by role split them cleanly between `t-title` and `t-prose`. The real hole was
  somewhere else entirely, above `t-title`, with three sites. Counting call sites would have minted
  the wrong tier.
- **A gate that matches one spelling measures nothing.** The dash gate read kebab case only and saw
  8 of about 30 real sites; 20 were camelCase JSX. The type gate read `px` only, so `text-[0.7rem]`
  survived every sweep including the ADR that named it. Widen the regex before trusting the count.
- **One authority stops at the language boundary.** `visual-law.json` had two readers, and every
  web-side gate was green while `/runs` and the Python renderer drew the same zone boundary two
  different ways. A shared data file needs a check on each side.
- **Deleting a control deletes its behaviour.** Twelve sites left `ui/button` for hand-written
  chrome. Size and ground were transcribed; hover, focus and the press-down nudge were not.
- **Furniture claiming an affordance is a lie the guard cannot see.** `PaneStrip` rendered buttons
  with a title, a `disabled` and no handler. They are honest read-only text now. No action was
  invented to justify the shape.
- **A tone is a claim about meaning.** `alarm` is the model disagreeing. A person flagging a room
  for export is `caution`. An export verb produces an artifact outside the app and touches no model
  data, so it is `act`, never `commit`.
- **Fix at the primitive, not the call site.** `HelpTip` clipped on three of six new placements
  because it was absolutely positioned inside scroll containers. It moved onto the repo's existing
  popover foundation once, and every consumer got the portal and the `aria-describedby`.
- **The browser finds what the guard cannot.** Duplicate React keys in `/param-tables` variant C
  came from repeated FOM `headRow` labels in a browser pass, not a deterministic lane.

## Verdicts later

Open questions in behaviour terms. Each needs an observation or a product call, not a refactor.
[`LEDGER.md`](LEDGER.md) Owed owns them; this is the reading list.

1. Is `reference` legible at drawing scale? Its `12 3 2 3` pattern replaced four literals across
   four scales, and the shortest consumer — the RCP leader in `family/anatomy`, about 36 user
   units — fits under two repeats and may read as one long dash. Either the shared pattern changes
   or the shortest consumer does.
2. Is the grille overrun rectangle correctly `void`? It outlines geometry the design asks for that
   cannot be built. `void` says "not material" and the alarm hue says "this is a problem". The
   alternative reading is that an overrun is its own role. Do not mint a fourth dash role without
   this verdict.
3. What tone and direction do session-driving verbs take — open in Revit, open view, reveal json in
   IDE, open .r10 in RHVAC? They drive a session and write no model data. Candidate is neutral ink,
   not blue. Rule it when the first one ships.
4. Should `PaneStrip` gain a real pane-opening action, or be deleted? It is honest today and claims
   nothing. Its purpose — gated panes a user can open — is unbuilt, and the product shape has not
   settled enough to say which.
