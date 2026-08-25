# Deterministic route diagram generation

## Question

Can static route declarations plus an Effect Atom registry generate a route UI diagram without running React?

## Verdict

**Partly.** The experiment deterministically generates an architecture graph. It cannot generate a faithful UI diagram from these inputs. The missing information is visual law: layout, containment, conditional visibility, event bindings, and the mapping from a state value to a color, decoration, or displayed value.

The generated bench graph has 70 nodes and 63 typed edges. Two calls with the same objects produce byte-identical Mermaid and JSON. Vitest stores the Mermaid as a snapshot.

## Prototype

`describeRoute(state, product, host)` combines three sources:

1. `ProductDeclaration` contributes URL bindings, feeds, stages, verbs, demands, panes, and draws edges (`diagram/diagram.ts:105-125`). This is the useful static shape from `targeting/model.ts:63-113` in the takeoff-frontier checkout.
2. `HostDeclaration` contributes backend entities, operations, latencies, read edges, invalidations, and pushes (`diagram/diagram.ts:127-146`).
3. `state.inspect()` contributes URL, persisted, page-memory, and feed taxonomy. `registry.getNodes()` contributes labeled derived nodes and dependency edges (`diagram/diagram.ts:96-103,148-165`).

`toMermaid` assigns node identifiers after sorting the graph. `toJson` serializes that same canonical graph (`diagram/diagram.ts:181-195`). The test constructs the bench Product and host declarations without React, compares two serializations byte for byte, and snapshots Mermaid (`diagram/diagram.test.ts:13-90`).

The generated output answers questions such as:

- Which feeds does a pane draw?
- Which URL bindings does a verb demand?
- Which host write invalidates a feed?
- Which host event pushes a feed?
- Which labeled atoms depend on other labeled atoms?

## Determinism boundary

The generator sorts nodes and edges by stable declaration keys. It excludes state values, timestamps, listener counts, and registry lifecycle state because those change while Effects run. It also validates every edge endpoint before serialization.

The Atom graph is still runtime-shaped. Effect creates some registry nodes lazily. The same declarations can therefore yield a different graph before and after a component or test first reads an atom. `Atom.withLabel` supplies names, but it is optional and does not declare state kind. Determinism holds for the same materialized input graph, not for every possible moment in the route lifecycle.

## What the experiment found

### Static declarations carry most architecture

Product supplies user-facing nouns and capabilities. Host metadata supplies the backend boundary. The registry supplies actual derived dependencies. Their union is enough for a useful dependency diagram and catches omissions that a hand-drawn diagram can hide.

For example, the generated graph exposes both `session feed` and `sessions feed`, and both `view feed` and `views feed`. Product keys are singular while the prototype's inspect taxonomy is plural. The generator cannot safely guess that these pairs are aliases. A promoted schema needs one canonical state-node key across Product, Feed, host metadata, and visual bindings.

### The MockHost type is not enough

`MockHost` declares callable methods, but TypeScript erases the return entity, latency, invalidation, and push metadata at runtime. The experiment adds `HostDeclaration` as a separate static table. Generating it from the interface would require source-code analysis and conventions for facts that are not present in the type. That would be more machinery without adding truth.

### Atom topology does not describe UI

Parents and children say that one atom derives from another. They do not say that a component renders a badge, table cell, SVG rect, Suspense boundary, or hidden Activity subtree. Listener counts say what is mounted now, not what the route declares. Registry topology also cannot recover component order or pane containment.

### Visual bindings are irreducible input

`bindings.ts` sketches the smallest missing declaration: visual kind, subject, canonical state node, and a value projection (`diagram/bindings.ts:1-29`). Examples map the zones Feed to badge color, dirty state to a row dot, and staged state to a cell value. This table can generate annotations on a diagram. It still does not define layout, and it should not grow into a second component system.

## Recommendation

Keep `RouteGraph`, `toMermaid`, and `toJson` as a research result. They are useful for architecture review and drift checks. Do not claim UI generation.

If this moves beyond the experiment, add only two declarations to the route model:

1. A canonical `stateNode` key shared by Product, host operations, inspect taxonomy, and visual bindings.
2. A small visual-bindings table for state projections that matter to review.

Do not encode CSS, component trees, or layout in Product. React remains the executable UI declaration; browser or screenshot proof remains necessary for the actual surface.

## Proof

- Deterministic lane: `vp test src/state-bench/effect-atom/diagram/diagram.test.ts` passed 1/1. The first run wrote one snapshot; the second run matched it.
- Check lane: `vp check apps/web/src/state-bench/effect-atom/diagram` passed with no formatting, lint, type, or warning findings.
- Runner papercut: Node printed ``--localstorage-file` was provided without a valid path``. The test still passed; the warning comes from initializing the existing KVS-backed state in Node.

## Follow-up: Mark state table

Eight `Mark` declarations produced 48 cells. Ten cells were `∅`: bound `live`, `fresh`, `stale`, `loading`, and `fixture` for each Plan feed, `view` and `zones`.

| `∅` cells | Finding |
|---|---|
| Plan × view × five non-error states × bound | Legitimate nothing to show. `view` is a basis for the zones read; the canvas has no direct view decoration. |
| Plan × zones × live/fresh/fixture × bound | Not UI holes. The SVG rects render, but the coarse canvas content has no Mark. |
| Plan × zones × stale × bound | Not a UI hole. The retained canvas and route feed caption handle it, but no plan-local stale Mark declares that fact. |
| Plan × zones × loading × bound | Not a UI hole. Suspense renders the fallback, but the fallback has no Mark. |

For `/takeoffs`, this table would expose S8 only as an uncovered `stale` row; it would not prove the missing producer in S8, the hard-coded provenance in S9, or the effect/query reconciliation loop in S15.

Deterministic proof: the 48-cell Markdown snapshot passed twice and `vp check apps/web/src/state-bench/effect-atom/diagram` reported no findings.
