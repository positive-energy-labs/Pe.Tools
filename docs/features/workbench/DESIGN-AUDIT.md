# /chat (workbench) — design-language audit

What the workbench surface needed that `components/lang` + the `--r-*` canon could not say,
recorded during the design-language sweep of 2026-08-16 (workbench pass). The workbench is the
first CONVERSATIONAL consumer of the language — a transcript, a minimap, an approval gate, and a
context inspector, none of which is a table — so the friction here is evidence about how far the
grammar reaches off the grid, not a complaint about this route.

Governance for this pass: `components/lang/*`, `components/master-table/*`, `components/sentence.tsx`,
`styles.css`, `design-lang.css`, and every route outside the surface were **not** changed. Where the
language could not express something, the code was left honest and the gap written down below.
These are for joint review; nothing here is a decision — except where a standing question was
explicitly delegated to this pass (#1).

Companion canon: [`../../design/SURFACE-PHILOSOPHY.md`](../../design/SURFACE-PHILOSOPHY.md),
[`../design-lang/CLEANROOM.md`](../design-lang/CLEANROOM.md), `apps/web/src/design-lang.css`
(the header is the law). Sibling audit in the same format:
[`../takeoffs/DESIGN-AUDIT.md`](../takeoffs/DESIGN-AUDIT.md).

---

## A · State census

Every distinct state the workbench renders, against the four axes (**freshness** · **agreement** ·
**staging+author** · **capability**, per R1) and the **outcome lane** (`OutcomeKind`). "—" means the
axis says nothing about this state; **bold** marks a state with no axis at all.

### Conversation / provenance states

| # | state | means | fresh | agree | stage | cap | outcome | rendered as, after the sweep |
|---|---|---|---|---|---|---|---|---|
| 1 | user turn | you said this | — | — | — | — | — | right-aligned block, neutral 6% ink wash, "you" head — **no identity hue** (#1) |
| 2 | pea turn | pea said this | — | — | — | — | — | left prose, `--r-pea-ink` head, pea mapdial band |
| 3 | pea streaming | reply in flight | — | — | — | — | busy-ish | `mg-caret` blink in `--r-pea` (**not** an OutcomeLine; #4) |
| 4 | focal turn | "where am I" on the timeline | — | — | — | — | — | neutral `--r-ink` left rule + widened band (R13a locate mark) |
| 5 | tool call running | pea acting on the world | — | — | — | — | busy | pea rail + sheen, mono "run" in `--r-ink-2` |
| 6 | tool call done | it ran | — | — | — | — | receipt | mono "ok" in `--r-done` |
| 7 | tool call failed | the bridge/tool errored | — | — | — | — | error | mono "err" in `--r-caution` (never the alarm) |
| 8 | approval owed | pea asks; your call blocks the run | — | — | — | — | — | **no axis** — Verb pair (commit/act) at the marker; header lamp `--r-caution` (#3) |
| 9 | plan entry completed / in flight / pending | pea's plan state | — | — | — | — | — | ✓ `--r-done` / ▸ `--r-ink-2` / ○ `--r-ink-mute` in an ArtifactFrame |
| 10 | thread running (list) | a prompt is in flight elsewhere | — | — | — | — | busy | pulsing `--r-ink-2` dot + mono "running" |
| 11 | thread read-only | another tab owns the write lock | — | — | — | `readonly`-ish | — | banner + `Take over` Verb (reason on title) |
| 12 | empty thread | nothing said yet | — | — | — | — | — | `EmptyState story="scope"` under the Pea hero |

### Target / world states

| # | state | means | fresh | agree | stage | cap | outcome | rendered as |
|---|---|---|---|---|---|---|---|---|
| 13 | target pinned / implicit | the chat is bound to a live session | `fresh`-ish | `agree` | — | — | — | rail + dot `--r-done`; resolved session row = `--r-select` FILL |
| 14 | target ambiguous | >1 session, no pin | — | — | — | — | — | rail `--r-caution` |
| 15 | target dangling | the pin claims a session that is gone | — | `drift` ✅ | — | — | — | rail `--r-alarm` — the claim disagrees with the world (#5) |
| 16 | no sessions | nothing to bind to | — | — | — | — | — | `EmptyState story="scope"` with launch exit |
| 17 | session lane (installed/dev/sandbox) | which kind of Revit | — | — | — | — | — | taxonomy → viz ladder via shared `laneVar` (#6) |
| 18 | session-gone tick | the world changed under the thread | — | — | — | — | — | `--r-caution` tick on the mapdial band |

### Context / cache states (world lane)

| # | state | means | fresh | agree | stage | cap | outcome | rendered as |
|---|---|---|---|---|---|---|---|---|
| 19 | layer identity (tools/system/skills/memory/messages) | which layer | — | — | — | — | — | taxonomy → `--viz-6/3/2/5/1` (identity carried from cat-*) |
| 20 | ≈ cached | prefix survived, 0.1× | `fresh`-ish, **inferred** | — | — | — | — | `--r-done` badge, mono, "≈" carries the uncertainty (#7) |
| 21 | ≈ reprocessed | full price this send | — | — | — | — | — | `--r-caution` badge |
| 22 | changed this send (Δ) | layer differs from last send | — | — | — | — | — | caution wash + caution border; Δ toggle pressed = `--r-select` fill |
| 23 | blast radius (prefix/system/free) | cost of the change | — | — | — | — | — | caution / ink-2 / done badges |
| 24 | item load state (in / on-demand / off) | is it in context | — | — | — | — | — | neutral mono pills — label carries it; dashed REMOVED (#8) |
| 25 | OM window active (reflecting/observing) | compaction running | — | — | — | — | busy | pulse animation + ⟲ in `--r-ink-2` |
| 26 | cache horizon | inferred boundary of reuse | **inferred** | — | — | — | — | solid `--r-ink` locate tick (was dashed blue; #7) |
| 27 | reflect floor | recorded low-water mark | — | — | — | — | — | solid `--r-caution` hairline (was dashed) |
| 28 | no context yet | nothing sent | — | — | — | — | — | `EmptyState story="scope"` |

**Axis verdict.** 2 of 28 map onto the cell grammar's axes (#13's agree/fresh reading, #15's
drift). The rest are CONVERSATION and PIPELINE states the axes were never written for — but the
**outcome lane** and the **meaning roles** covered nearly all of them (9 states ride
busy/receipt/error semantics; 11 ride done/caution/alarm/pea/select/viz). The grammar's colour
half generalizes off the table; its axis half does not need to (#2).

---

## B · Findings

### 1 · THE "YOU" IDENTITY VERDICT: no hue — position already carries authorship (evidence)

**The standing question** (R14, styles.css shim note): does the user need an identity hue, or is
`--user` (shimmed to neutral ink) deletable?

**What the surface showed.** Authorship in the transcript is carried by FOUR redundant channels
before any colour is spent: (a) user turns are right-aligned blocks with a fill; pea turns are
left-aligned prose; (b) every turn carries a "you"/"pea" head label; (c) speaker handoffs draw a
hairline; (d) the mapdial alternates band positions per exchange. In grayscale the surface loses
nothing — which is the viz ladder's own test for "colour only speeds it up".

**What was rendered.** "you" = `--r-ink-2` head + a 6% ink wash on the block (no border — plain
prose is never enclosed). Pea keeps `--r-pea`/`--r-pea-ink` everywhere (bands, rails, caret,
name). The asymmetry is the design: **the agent is the marked case; the human is the ground.**
Every mark that must distinguish you-from-pea at a glance (mapdial bands, focal band) separates as
neutral-ink vs pea-green, which also survives grayscale by position and label.

**One cost, priced.** The old `--user`/`--pea-line` washes made user and pea bands two hues of
equal rank; now the user band is "uncoloured". On a 8px band with no label visible until hover,
the neutral wash is quieter than the pea wash — acceptable, because the question the dial answers
("where is the conversation, where are the tool bursts") reads off pea's marks.

**Verdict for joint review: delete the `--user`/`--user-tint`/`--user-line` shim lines.** Zero
consumers remain. No new colour was invented; nothing borrowed a meaning role.

### 2 · The cell-grammar axes do not describe a conversation — and did not need to

**Surface fact.** The census maps 2 of 28 states onto the four axes. A transcript's states are
about ACTS (running, landed, refused, owed) and PROVENANCE (who said it), not about a value's
freshness/agreement/staging.

**What held instead.** The outcome mapping (busy/receipt/error/…) and the meaning roles carried
26 of 28 states without inventing anything. The workbench needed no new token, no new axis, no
sixth colour.

**For the record, not a proposal.** Do not grow the axes toward conversations; the outcome lane
IS the conversational grammar, and it sufficed.

### 3 · An owed approval has no home in the language

**Surface fact.** The single most important workbench state — "pea is blocked on your call" —
renders as a Verb pair at the tool marker plus a caution lamp in the header. It is state #8 in
the census and it has no axis, no outcome kind ("busy" is wrong: nothing is running; "advisory"
is wrong: it blocks), and no component.

**Same hole as takeoffs #2 / R3.** A queued human decision is a ROW fact there (gutter marker);
here it is a TURN fact. The chat has no gutter, so the decision renders where the evidence is
(the marker) — consistent with R3's spirit. But nothing counts the owed decisions: with three
pending approvals in a long thread, nothing outside the transcript says "3".

**Proposed resolution.** When outcomes gain their verb/target link (CLEANROOM frontier), an
`owed` outcome kind — or a mapdial approval tick count — becomes expressible. Until then the
mapdial's `.approval` band (caution) is the only aggregate signal, and it is per-turn, not a count.

### 4 · Streaming has no outcome kind, and should not be one

The blinking caret (`mg-caret`, now `--r-pea`) is "pea is mid-utterance" — not `busy` (that means
a machine fact in flight, mono text), not a receipt. It is pea's presence. Rendered as an agent
identity mark; recorded so nobody "fixes" it into an OutcomeLine later.

### 5 · A dangling target pin wears the alarm — a deliberate reading, flag if wrong

The rail maps pinned/implicit → done, ambiguous → caution, dangling → **alarm**. Argument: the
pin is a claim ("this chat acts against session X") and the world no longer contains X — the
claim disagrees with reality, which is the drift family's top rank, and drift wears the one
alarm. Counter-argument: nothing the MODEL said is being contradicted, so this stretches "the
model disagrees" to "the record disagrees". If joint review narrows the law, the fallback is
caution — one line in `TARGET_RAIL_COLOR` (Lens.tsx).

### 6 · `host/target-ui.tsx` still speaks the old vocabulary and is outside every route pass

`toneColor`/`LiveDot`/`LaneBadge`/`laneVar` spend `--pe-blue`, `--cat-*`, `--line-2` — including
BLUE for "pinned", i.e. a selection state wearing the commit hue, and viz hues carrying state
(kiln = ambiguous, clay = dangling). Consumers: this surface (Lens rail — worked around with a
local map; LiveDot/LaneBadge in chat-target — NOT worked around, still old-vocabulary), plus
`ops/`. No route pass owns `host/`; until one does, the last consumers of `--pe-blue` and
`--cat-*` cannot be removed and the session-row dots on this surface render the old hues inside
migrated chrome. **Needs an owner** — a small shared-file ruling, ~40 lines.

### 7 · "≈ inferred" has no mark — the estimated/measured distinction is carried by copy

§4: "a mark derived from real coordinates and a mark derived from a guess must not look the
same." The cache state, the horizon, and the token estimates are all frontend-inferred, and the
squiggle family (the language's uncertainty vocabulary) lives on `StateCell`, which this surface
cannot use. The pass settled on: solid marks + a literal "≈" prefix + title provenance. The old
rendering spent DASHED on the horizon — wrong slot (dashed = seam, and the horizon exists). If
inferred-ness deserves a mark outside cells, that is a language extension; not invented here.

### 8 · Dashed spends found and re-expressed (the budget audit)

| where | old meaning | disposition |
|---|---|---|
| `lens-marker.tool` left rail | "tool = pea acting" | ❌ → solid `--r-pea` rail (a tool call is real, not a stand-in) |
| world-lane "on demand" pill | loadable but not loaded | ❌ → neutral mono pill; the label carries it |
| control-chips empty picker | no options | ❌ → `EmptyState` with exit (a scope-empty, not a seam) |
| budget-bar reflect floor | recorded low-water mark | ❌ → solid `--r-caution` hairline |
| budget-bar cache horizon | inferred reuse boundary | ❌ → solid `--r-ink` locate tick (was dashed **blue**) |
| doc chips (`document-chips.tsx`) | "no document bound" | file was DEAD (zero importers) → deleted |

Zero dashed spends remain on the surface. None of the six was a seam; the workbench currently has
no true seam state (its fixture lane died with the doc chips).

### 9 · `Verb` fits chat controls; icon-only chrome still needs `ui/button`

Approve/deny (HITL), Take over, Refresh/Preview/Apply, and the reviewer's approve/deny/undo/commit
all migrated onto `Verb` with required reasons — the constructor argument surfaced four refusal
sentences that previously did not exist (e.g. "Preview first — apply only writes the exact profile
you previewed"). Three `ui/button` imports remain, all icon-only or render-prop shapes `Verb`
does not offer: the composer's send/stop/attach (send IS a legal filled blue — it writes beyond
the page), the plugin pane's close ×, and the Combobox trigger in control-chips (a render-prop
slot expecting Button). If the language wants them, `Verb` needs an icon-only form; not invented
here.

### 10 · The jump-to-tail control was ruled nav

`↓` on the mapdial re-attaches the view to the live tail — within-page movement, so it wears
nav's blue TEXT (`--r-nav`), not a fill. Recorded because "scroll controls are nav" is a reading,
not a written law; the alternative (neutral ink act) costs nothing if review disagrees.

### 11 · Legacy type bundles are off the surface; two intentional stretches

`tele`/`tele-label`/`section-label` have zero uses on the surface; every text spend is
tier × face × case. Stretches to review: (a) role heads ("you"/"pea") are `t-label t-upper` —
which carries the section-head semibold; if heads-in-chrome should stay weightless, a `t-upper`
without weight does not exist. (b) `doc-picker`'s old 8px mono went to `t-caption` (10px floor) —
the picker rows got two px taller.

### 12 · Fixed en route: straight violations with no ruling needed

- The empty-thread hero "Pea" was `--pe-blue` — the agent's own name in blue ("pea is never blue").
- The focal turn rule and mapdial reticle/caret were blue or provenance-hued — "where am I"
  marks, now neutral ink (R13a).
- Plan status spent `--pe-blue`/`--kiln` (blue for busy, viz for pending) → done/ink-2/ink-mute.
- `RouteWorkspaceShell`'s h1 and the trichotomy row labels wore `--clay-ink` (= the alarm, via
  shim) as decoration → ink.
- Evaluation issues and `Metric issue` spent `--fail`; blocking machine refusals now wear the
  alarm (legal: refused → alarm), attention counts wear caution.
- `font-bold`/semibold chrome (Δ button, layer labels, thread titles, "New thread") stripped —
  bold is reserved for unsaved.
- Hover was four idioms (`bg-paper-2`, `bg-muted`, `primary/10`, opacity) → the one veil,
  composited as a background-image everywhere.
- Selection was four idioms (blue border-left, paper+inset-shadow, `--primary` tints,
  `data-selected:bg-paper-2`) → the `--r-select` fill everywhere (thread rows, session rows,
  palette cursor, doc rows, Δ pressed).

---

## C · What migrated

| | count | notes |
|---|---|---|
| `Verb` | 11 | aui approval allow/deny (commit/act) · chat-shell Take over · parameter-links Refresh/Preview/Apply (1 commit) · reviewer Deny/Approve/Undo/commit (1 commit) |
| `ArtifactFrame` | 5 | ContextStrip plan / system-prompt / context-injected · `InlineRoutePlugin` (pea's chat card — the border-budget flagship) · composer kept its hand-built artifact treatment (ground shift + hairline; frame layout didn't fit a form, noted) |
| `Switcher` | 2 | ModeDial (threads/trace/world) · world-lane Plain/Inspect density dial |
| `EmptyState` | 5 | empty thread · no threads · no sessions · no context sent · picker with no options |
| `FactChip` | 2 | CTX injection chip · "snapshot @ send #N" |
| selection → `--r-select` fill | 5 sites | thread list, palette cursor, session rows, doc rows, Δ toggle |
| hover → the one veil | 12+ sites | one idiom replaces four |
| illegal dashed re-expressed | 5 | plus 1 dead file deleted; see #8 |
| legacy type bundles shed | all | 0 `tele`/`tele-label`/`section-label` remain; ~40 arbitrary `text-[Npx]` killed |
| dead code deleted | 391 LOC | `components/document-chips.tsx` (zero importers) |

**Files touched:** `workbench/lens.css`, `workbench/Lens.tsx`, `workbench/aui.tsx`,
`workbench/world.tsx`, `workbench/prose.ts`, `workbench/route-chat-plugins.tsx`,
`workbench/trichotomy-reviewer.tsx`, `workbench/route-workspace-shell.tsx`,
`workbench/plugins/*.tsx` (3), `components/chat-shell.tsx`, `components/chat-target.tsx`,
`components/composer.tsx`, `components/thread-palette.tsx`, `components/mode-dial.tsx`,
`components/control-chips.tsx`, `components/doc-picker.tsx`;
`components/document-chips.tsx` deleted. Nothing under `components/lang/`, `master-table/`,
`sentence.tsx`, `styles.css`, `design-lang.css`, `host/`, or any other route.

**Shim lines whose LAST consumer this pass removed** (deletion is the sweep owner's move, per
protocol — verified zero `var(--…)` consumers outside `styles.css`):
`--user`, `--user-tint`, `--user-line` (the whole workbench-identity block, per #1),
`--pea-tint`, `--pea-line`, `--pe-blue-soft`, `--lens-ink-2`, `--mist`, `--basalt`, `--ink`,
`--slate`, `--paper-2`, `--paper-3`, `--fail`, `--clay`, `--clay-ink`, `--clay-tint`, `--kiln`.

**Still consumed elsewhere** (not this pass's to free): `--paper` (sentence.tsx), `--pe-blue`
(host/target-ui, ops, ui/pane…), `--pe-green`, `--lichen`, `--line`, `--line-2`, `--line-soft`
(ui primitives, ops, host) — see #6 for the biggest blocker.
