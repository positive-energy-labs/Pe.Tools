# /settings — find-the-product

Living doc for the settings-panes rounds. Single home for verdicts. Surfaces caught up: none yet —
round 1 in flight on worktree branch `worktree-settings-panes-2026-08`.

## What this product is (ruled before round 1, 2026-08-17)

Settings is **not a page product — it is a kit of easily-wired pane components** (generated form,
raw JSON editor, settings file tree) meant to be composed inside real routes: /families (very wip),
/family (wip), and eventually a web Schedule Manager (`CmdScheduleManager`'s browse → preview →
create loop is the strongest tree+form+json story we have). The /settings route **survives as the
thin "open any settings file" raw utility** — the full composition's reference consumer — while the
components are the real product. (User ruling, 2026-08-17.)

The precedent is the current /settings route: the substrate-backed trichotomy reviewer over one
JSON file. It taught us the state model (proposal → staged → save, pointer-keyed `fields`, the
route-state SSE bridge, the chat-plugin reviewer). Its layout — one flat field list under a
picker head — is the first thing to discard.

## Constraints carried into round 1

- **Contract fact:** there is no raw-content save for an *existing* document. `create` takes
  `rawContent` but fails if the path exists; `save` splices staged fields only. A whole-file write
  lane needs a new host-facing command → SHIMS when/if that lane wins.
- **Chat-plugin compatibility:** pea proposals arrive pointer-keyed into `fields` over SSE, and
  `SettingsChatPlugin` renders the same substrate in chat. Any raw-editing design that abandons
  pointer-keyed fields blinds the chat lane. This is a first-class judging axis for round 1.
- **Raw JSON editor:** `@tanstack/highlight` is read-only highlighting — the editor is the classic
  transparent `<textarea>` over a highlighted `<pre>`. One shared primitive; the *write model* is
  what varies.
- **Form-route head ruling (2026-08-16):** on a form route the pickers ARE the sentence. Round 1 is
  allowed to attack this (B retires the sentence for a tree).

## Round 1 — what is the composition?

Question: **how do form, raw JSON, and tree compose as panes — and what is the raw-edit write
story?** Both write models get built; the round rules. `?variant=` on /settings, shipping surface
stays the default. All variants ride one shared fixture (`settings-panes/fixture.ts`, a real
schedule-profile-shaped document with seeded proposals/staged/attention states) declared with a
fixture chip — variants must be comparable without a live host.

| v | frame | tree | form/json | raw-edit write model |
|---|---|---|---|---|
| A | modeful document | none — file picker chains the sentence | ONE pane, form ⇄ raw mode switch (pseudo-dimension law: two readings of one coordinate set) | parse-diff → staged fields, existing save gate |
| B | IDE workbench | real left tree pane (tree IS the addressing; sentence dies) | form center + raw right, both visible, synced | whole-file save lane (stubbed, gap recorded) |
| C | annotated file | thin popover from the sentence | the raw JSON IS the page; trichotomy renders as line-anchored gutter marks/overlays; approve/deny on lines; validation issues joined to lines (fixes audit #5) | edits parse-diff to per-pointer stage/sever |
| D | embedding proof | inside each host pane | two mock host panes (family-ish, schedule-profile-ish) each embedding the kit with minimal props | whichever props are smallest — the point is the prop contract |

### Verdicts (owed)

_(recorded here after the user flips through — which frame won, which write model, what B/C/D
donate, what got retired.)_
