# pages map: the doors still open

Live frontier. Opened 2026-10-05 by counsel at kaitpw's ask; rulings 1 to 8 of the first round were answered the same day and moved to the LEDGER (the 2026-10-05 Decided lines). What stays here is what kaitpw deferred: "I really want 3 and 4, but these should come after more complexity arises and I feel the pain." Sweep this file when either lands or is rejected.

## The law that ranks every candidate

A primitive that helps the user understand is important; where the agent cannot see or understand on its own, a primitive that helps both user and agent is the most important. Tier 1 (both-sided) and tier 2 (durable pictures) are built. Tiers 3 and 4 remain.

## Tier 3, rendering helpers (deferred until a page hurts)

| Candidate | What it gives a page | Source | Weight |
|---|---|---|---|
| `/pages/code.js` + `code.css` | `<pre><code class="language-csharp">` highlighted on load, and `code.html(src, lang)` for templates | `@tanstack/highlight` (installed, class-based, no deps) plus the web app's `csharp-language.ts` | 305 KB dist; a page build picks languages |
| `/pages/diagram.js` | `<pre class="mermaid">` drawn as SVG in house tokens | `beautiful-mermaid` (installed, DOM-free, `var()` colors), with the web app's style stripping and SVG sanitizer | 1.2 MB with elkjs; lazy on the first diagram |
| Markdown | `md.html(text)`: a page embeds a LEDGER section or an agent's note as written | `marked` is 40 KB and dependency-free; `react-markdown` is React-bound | one new dependency, or none |
| JSON tree | a collapsible reading instead of `JSON.stringify` | native `<details>` nesting, 30 lines in pe.js | none |
| Stamps as glyphs | `PROVEN[...]`, `FALSIFIED[...]`, `UNPROVEN[...]` as chips with the bracket text on hover | pe.css classes and `pe.stamp(text)` | none |
| Door gallery | one kit page per door showing every piece with its spec beside it | kit pages that are themselves pages | authoring |

Mechanics when it lands: one vendoring step (`pnpm pages:vendor`, esbuild each door to an IIFE under `src/pages/vendor/`, gitignored, run by the dev task), wrapped by the host exactly as `revit.js` is. Import maps over `node_modules` and a Vite lib build on every start were considered and lose on fragility and start time.

## Tier 4, state hygiene (deferred; no compile step involved)

1. Schema version on every event: kernel option `version`, `fire` stamps it, `replay` drops other versions (they stay in the log). pdrop-tour does this by hand with `v: 2`.
2. Dedupe by `id` as a kernel option `once: ['tried', 'note']`.
3. Form controls as events: `pe.bind(root)` turns `data-ev` controls into fires. pdrop-tour wires its verdict selects one by one.
4. Render per region, never the body; a DOM morph helper (idiomorph, 10 KB) only if a page profiles as losing focus.
5. Readings carry their script sha and the host's action-journal seq, so a later reader knows which Revit state they describe. (`pe.reading` carries `source` and `at` today.)

## Tier 2 residue

- Freshness on the picture: a capture older than the last write to the document is marked stale; the host knows both from the receipts and the action journal.
- Then and now: two captures of the same view and ids side by side, the picture form of `rv.compare`.
- `revit.ui.screenshot`: PrintWindow on the Revit main window or a dialog HWND, registered as a capture; the facsimile asserts, the screenshot proves.
- A chrome-agent screenshot of a page registers as a capture (already Owed in the LEDGER).

## pdrop-tour migration, when the doors are proven live

In this order: the 14 `MOCKS` palettes to `rv.fromElement` over a reading; the 14 C# strings to `checks/*.csx` files; the routing figure to `rv.fromRouting` over the `routing` check; readings to `pe.reading`; a `pe.describe` so the ducts agent reads the panel as text.
