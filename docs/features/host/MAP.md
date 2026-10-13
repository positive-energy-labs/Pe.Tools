# Revit world cluster, protoui frontier

Live effort map. Delete this file when the cluster lands in canon; promote what survives into `LEDGER.md`.

## Fixed constraints (kaitpw, 2026-10-12)

- One world: the `Machine` reading is what the cluster renders and what `pe_find` returns.
- No staged launch. Consequences are choices on the verb.
- A proposal is a review artifact. The only write gate is the thread head on a user document.
- Pea's background sessions appear in the same world with minimum visibility: what Pea works on, its latest activity, its result.
- One component, three homes: machine drawer, composer-head popover, `/open` route.

## Round 1 (2026-10-12)

Page: `.artifacts/runs/protoui-20261012-revit-world/index.html` (`?variant=A..D&home=route|drawer|popover`).

| Variant | Shape |
|---|---|
| A Ledger | One table, rows grouped by Revit, verbs on hover |
| B Sentence | The composer sentence grows; "Yours" and "Pea's desk" lanes |
| C Desk | Each Revit is a window with document tabs; drag a recent onto a window |
| D Feed | Pinned state chips over an event timeline (overreach: needs an SDK event stream) |

Shared across variants: the open sentence that fills itself, the `r`/`rw` io mark as the grant display, the "Pea sees" JSON pane.

Verdict (kaitpw): C wins on the route. The drawer and the popover render rows like the machine drawer's Revit group. Search must reach every local and cloud document. The open cluster with every option is still owed; round 1 left it under-built.

## Round 2 (2026-10-12)

Page: `.artifacts/runs/protoui-20261012-revit-world/r2.html` (`?variant=O1..O4&home=route|drawer|popover`). Layout fixed: desk on the route, machine-drawer rows elsewhere. The variants are the open cluster.

| Variant | Shape |
|---|---|
| O1 Omnibox | One search field; on pick, chips like Pea's composer (Revit, for whom, window, add-ins, central) |
| O2 Sentence | "Open [doc] in [Revit], [for whom]." with the rest as operable words |
| O3 Drop | Drag a result onto a Revit window or row, or onto "new Revit"; the plan lands there |
| O4 Verbs | Each result expands to its own plans as buttons ("Open in your Revit 2025", "Give Pea a copy") |

Shared rule under test: every option has a derived default, and the verb names each consequence ("Open in your Revit 2025 · upgrade from 2023 · without 2 links"). Pressing it consents. No separate consent step.

Options covered, from `docOpenArgv` in the vendored contract: source (recent, this PC, cloud, pasted path, template), target session or new Revit, year, for whom (copy for Pea is background, headless, detached), window, add-ins off, detach, upgrade, missing links, switch or reload when already open.

Verdict (kaitpw): O4 wins in general (each result lists its own plans); keep O1's picker per option.

## Round 3 (2026-10-12)

Baseline `r3.html`, the user's own shape:
- Two lanes. Documents on the left, wider, as a table. The desk on the right, one card per Revit plus a "new Revit" card, and the same in every home.
- Open actions sit in a stationary footer under the table, like the inline Work line in chat. Nothing expands out of a row.
- The Open button stays disabled until a desk card is chosen. It then names that Revit and every consequence ("and upgrade from 2023"). A Revit older than the document is refused.
- A flow line runs from the picked row, or from the footer, to the chosen card.

Shared materials: `house.css` is the real look distilled; `world.js` holds one fixture world and the plan rules.

Adversaries, each told to argue against the baseline:

| Page | Model | Argument |
|---|---|---|
| `adv-presence.html` | GPT-6-Astra | No desk. Documents carry presence marks; the Revit is a consequence, not a choice |
| `adv-command.html` | GPT-6.1-Sol | A typed command line whose chips fill themselves, in the same grammar as Pea's call |
| `adv-patchbay.html` | Claude Fable 5.1 | Every open document is a cable from document to Revit, all the time |
| `adv-timeline.html` | GPT-6-Luna | Revits as lanes over time: history, Pea's receipts, the grant running out |

Verdict (kaitpw): the patch bay wins by far. It makes the split between document and session obvious. A forced choice of action button when you connect is a UI paradigm we need. The timeline is liked, but its selection semantics are too odd, and the value of time is unproven. The command line is welcome as a second control surface beside the patch bay, built on the table's filtering.

Components today (census, working tree):
- The documents table exists (`ts/apps/web/src/open/documents.tsx:101`). It needs a number condition on the year columns and a row `data-key` anchor (`ts/apps/web/src/components/master-table/master-table-body.tsx:70`).
- The command line extends `QueryBox` (`ts/apps/web/src/components/master-table/query.tsx:127`), which already has field, operator, value, chips and Tab completion. The launch tokens after the arrow are new vocabulary.
- The cable overlay is a new component. There is no connector primitive.
- The launch contract lacks template, detach, window, upgrade and reload. `unsynced` is hard-coded to keep (`ts/apps/host/src/instances-actions.ts:330`).

## Round 4 (2026-10-12)

Page: `.artifacts/runs/protoui-20261012-revit-world/r4.html`, built by Claude Fable 5.1 from `adv-patchbay.html`.
- The jacks are the master-table frame: source tabs, a saved-year filter and the command line in the filters band.
- The sockets are desk cards. The free card holds year, whose and add-ins.
- The cable adapter holds only detach. Window is gone.
- The command line builds the same plan as clicking.
- The rw cable carries a countdown band, and Pea's cables carry receipt ticks.

Receipt ticks are faked from the job counter; a real receipt store is owed before close.

Verdict (kaitpw): promote the round 4 shape, in the image of today's chat. Primitives and systems come first: prefer an existing component, make a new shared one when nothing similar exists, and write no ad hoc UI. The composer popover keeps its document pickers and gains an "open a document" mode next to them (a simple mode switch). The command line and the saved-year filter must work for real.

## Promotion (close), 2026-10-12

Port rules (census of today's kit and chat work):
- `Button`: `refusal` is the only inert state, with one string.
- `Row` and `List` for rows; `Pane` with its 8 px inset; `Ladder` and `ListPopup` for pickers; `Switcher` for modes.
- `OutcomeLine` and `EmptyState` for results and empty states.
- One artifact-plane hairline. No raw spacing utilities, no restated type classes.
- Every new mark gets a specimen.

Shims, in dependency order:
1. **Launch contract.** `instancesLaunchSchema` carries source, into (a session, or start a Revit with year, owner and add-ins), detach, upgrade, links and reload.
   - The staged trichotomy cell and `agentWriteMask` on instances are deleted (ADR 0016).
   - `restart`, `stop` and `close` become `actor:"any"`.
   - The host passes every option to `docOpenArgv`.
   - Pea's custody stops reading null (`ts/apps/host/src/local-ops.ts:75,138`).
   - A copy for Pea is detached for workshared and cloud models. For a local file, the host copies it into Pea's work folder first, and the receipt names the copy. This is a default and kaitpw may override it.
2. **Primitives.**
   - A connector overlay in `components/lang` (new; nothing similar exists) that draws a line between two anchored elements and survives scroll and resize.
   - The master table gains a row `data-key` anchor and number conditions on the year columns.
   - `QueryBox` grows an optional second vocabulary after an arrow: the command line.
   - One session renderer replaces `RunningBlock`, `RevitRow` and the bespoke confirm in `RevitControls`; the confirm moves to `ArmingStrip`.
3. **Surfaces.**
   - `/open` becomes the patch bay: the documents table as jacks, desk cards as sockets, cables, and a forced action button.
   - The machine drawer shows the same desk.
   - The composer document entry gains a `Switcher` between target and open.
   - The cable band counts the grant down.
   - Pea receipt ticks need a receipt source. They are owed if no store exists.
4. **Proof.** `pnpm verify`, `?demo=` seeds in the browser, then one real open driven by hand on a live host.

Status (2026-10-12): built on branch `feat/revit-patchbay` (worktree `.claude/worktrees/revit-patchbay`), not merged.
- Commits: `1ea0564d` (launch contract), `4a4cf553` (merge of the primitives), `9afc38e8` (the patch bay).
- PROVEN[deterministic, worktree, 9afc38e8]: 50 open, connector, query and machine tests pass.
- PROVEN[browser, hostless vp dev, 9afc38e8]:
  - `/open?demo=refresh` draws 11 jacks with their cables and no overflow.
  - Typing `clinic → new 2024` gives "Open in a new Revit 2024 and upgrade from 2023".
  - The composer's target/open switch mounts the bay in the popover.
- UNPROVEN: anything on a live host or in Revit.

Owed before it is done:
- **Merge into main.** kaitpw is editing main.
- **One real open, driven by hand.** It must check workshared detection on a real `.rvt` (the file-marker scan) and cloud detach.
- **The grant clock.** The host records no time for the user's last message, so live rw cables carry no countdown band.
- **Pea's result line.** Thread summaries carry no result. Receipt ticks need a receipt store.
- **Missing links cannot be named on the verb before the open.** Recents do not know them, so the SDK's refusal must come back as a choice.
- **Cloud hub browse.** There is no host route; the Cloud tab shows cloud recents only.
- **A `switch` verb** for a document already open in the target Revit. It needs an SDK and contract addition.
- **Small rulings from the builders:**
  - drawer verbs show on hover only;
  - `hr` shows on /open cards only;
  - the stacked table hides the where and open-now columns;
  - `SessionRow` has no consumer left.
- **Stale docs.** `AGENTS.md` Posture still says "agents propose", and the host and agent ledgers still describe staged launch.

## Open

Q13, Q14 and Q15 were ruled on 2026-10-12 and recorded in `docs/adr/0016-proposals-review-the-grant-gates.md`.


- Search terrain: cloud browse exists as `doc list --cloud --hub --project --folder` (`ts/packages/host-contracts/src/vendor/generated/pe-revit-contract.ts:1175`). UNPROVEN: whether it lists without a running, signed-in Revit, and whether name search across a hub needs a walk. Local search beyond recents has no backend; it needs a host folder index.
- Auto target for an older file: the page picks your running Revit (2023 to 2025) over starting the lowest installed year (2024). Both upgrades are permanent; the lower year keeps the file open to more colleagues.

- Q16: option homes. Proposal: each option has exactly one home, where its consequence shows. The jack holds source, search and saved year. The free socket holds a new Revit's year, owner and add-ins. The cable holds detach. Upgrade and missing links are words on the verb. A patched cable holds rw, switch, reload and close. The command line is a keyboard projection with no option of its own. Drop window from human surfaces.
