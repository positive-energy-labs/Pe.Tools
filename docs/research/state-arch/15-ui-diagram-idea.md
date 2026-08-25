# 15 — Deterministic UI diagrams from state declarations (idea + implications)

Question (kaitpw, 2026-08-24): can a diagram of a route — UI states × backend entities × backend
flow — be generated deterministically, for find-the-product sweeps and for user-facing docs?
Experiment running in `13-diagram-gen.md` (effect-atom worktree). This file is the thinking.

## 1. What is already declared, and what is not

| Layer | Declared today | Where | Generable? |
|---|---|---|---|
| Bindings, trunks, terminals, direction | yes, static data | `targeting/model.ts` `Product.links` | yes |
| Verbs → demands, commit/nav, refusal | yes | `Product.stages[].verbs` | yes (refusal text is runtime) |
| Panes → draws | yes | `Product.panes` | yes |
| Feeds → basis, state | runtime, per link | store (S3/S4) | yes, as a *type*; values only from a running store |
| Async chain (what reads what) | implicit in atom bodies | `AtomRegistry.getNodes()` parents/children | yes, from a running registry with labels; families must collapse |
| Writes → invalidation keys | yes, if S8 is followed | `withReactivity([...])` / `Reactivity.invalidate` | yes |
| Host ops, entities, latencies | in the C# op metadata + host catalog | `pe-dev ops-catalog`, host `/operations` | yes, already a public-contract projection |
| **Visual ↔ state** (color, dot, cell value, decoration) | **no** — lives in JSX conditionals | `atlas.tsx`, `kit.tsx` | **no, until declared** |

The gap is the last row. Everything else is a projection of things the shape already makes
static. So the idea is not "generate a diagram from code"; it is "make the one undeclared layer
declared, then every diagram is a projection".

## 2. The missing noun: a *Mark*

A Mark is the smallest visual fact a user can see: a color, a dot, a badge word, a cell value, a
strike-through, a disabled verb. Today a Mark is a JSX ternary. As data:

```ts
interface Mark {
  key: string;                       // "zone-row.dirty-dot"
  pane: string;                      // Product.panes[].key
  slot: "row" | "cell" | "badge" | "verb" | "sentence" | "canvas";
  visual: { kind: "color" | "dot" | "text" | "strike" | "disabled"; value: string };
  /** The state node it projects, as a path into inspect(): url.* | feeds.* | page.* | derived.* */
  reads: string[];
  /** The rule, as a small expression the generator can print (not run). */
  when: string;                      // "page.staged[id].base !== feeds.zones[id].name"
  /** What the user can do about it. */
  verb?: string;                     // "adopt"
}
```

Marks are declared next to the Product, not inside components; components *render* marks
(`<Dot mark="zone-row.dirty-dot" id={id} />`). That is the same move the targeting manifest made
for verbs (declare, then project).

## 3. What a generator can then emit (all deterministic, same input → same bytes)

| Artifact | Projection of | Audience |
|---|---|---|
| Binding sentence graph (trunk/terminal, direction) | Product.links | find-the-product |
| Demand matrix: verb × terminal, with refusal reason | Product.stages | find-the-product |
| Flow graph: url-binding → feed → host-op → entity, with latencies and invalidation edges | registry graph ∪ host catalog ∪ S8 keys | both |
| **State combination table**: for each pane, the product of the FeedStates it draws from × bound/unbound → which marks fire; blank cells = unhandled combos | Marks × Feed types | find-the-product (this is the "every nook" sweep) |
| **Legend**: "a blue dot on a zone row means `page.staged[id]` differs from the host's name; Adopt writes it" | Marks | users |
| Per-cell provenance tooltip: which target (session/doc/view) and which read (`basis`, `at`) a value came from | Feed.basis | users, agents |

The state-combination table is the find-the-product payoff: it is a truth table, so an unhandled
combination is a visible hole, not a discovered bug.

## 4. Implications

| Implication | Consequence |
|---|---|
| Marks are a third declared surface beside links and verbs | `Product` grows a `marks: Mark[]`; the seam census (`seams()`) can report "pane draws feed X but no mark projects state `error`" |
| The registry graph is only trustworthy with `Atom.withLabel` on every node and families collapsed | S10 becomes a lint: unlabeled atom = diagram noise |
| `when` is a string the generator prints, not code it runs | keeps the diagram deterministic and cheap; the *component* still runs the real rule — two spellings of one rule, so keep `when` tiny or derive it from a shared predicate name |
| Host ops/entities come from the C# authority | the diagram is honest about provenance: a node the catalog does not know is a seam |
| Same artifact serves agents | `inspect()` + Marks is the machine-readable form; mermaid/SVG is the human one. An agent reading the state table can say "no mark for `feeds.zones.state === 'stale'` in pane Plan" |
| Cost | one Mark per visual fact; /takeoffs atlas has on the order of 20–30 |

## 5. Where it fails

- Canvas panes (SVG plan, zone-plan) have marks that are geometry, not slots; declare them as
  `slot: "canvas"` with a coarse `when`, or accept the diagram stops at "canvas reads zones, regions".
- Derived-of-derived chains make the registry graph deep; the generator must cut at feed nodes
  and show the chain only on demand.
- If components keep private conditionals, the legend lies. The rule has to be "no visual
  conditional without a Mark", enforced by a test that greps JSX for `state ===` outside marks.

Verdict on the idea: yes — as an extension of the targeting manifest (links, verbs, panes, **marks**)
plus two projections that already exist (registry graph, host catalog). Wait for `13` to see how
much of the flow graph is derivable before hand-declaring anything.

## 6. Confirmed by the experiment (`13-diagram-gen.md`, same day)

| Prediction | Result |
|---|---|
| Architecture graph derivable from Product ∪ host declaration ∪ labeled registry | yes — 70 nodes / 63 typed edges, byte-identical mermaid + JSON, snapshot test passes |
| Visual ↔ state is the irreducible input | confirmed; `bindings.ts` is the Mark table in miniature |
| Registry graph needs labels and a lifecycle cut | confirmed; nodes materialize lazily, so determinism holds per materialized graph, not per moment |
| Host op metadata cannot come from the TS interface | confirmed; a `HostDeclaration` table was needed — in canon this is the C# op metadata / host catalog, already public-contract authority |
| It finds holes | it found one unprompted: Product keys (`session`, `view`) vs store taxonomy (`sessions`, `views`) — no canonical state-node key exists yet |

Next concrete step, if pursued: one canonical `stateNode` key shared by Product links, feeds,
host ops and Marks; then the state-combination table (§3) becomes a generator output.

## 7. Mark table result (`13` follow-up)

8 Marks × bench route → 48 cells, 10 `∅`, all on the canvas pane and all judged "legitimately
nothing to show" (view is a basis, not a decoration; Suspense fallback and retained canvas have no
Mark). Ceiling, stated by the builder: the table exposes **uncovered** states (it would have shown
census S8 as an uncovered `stale` row) but not **wrong producers** (S9) or **effect loops** (S15).
So: a coverage sweep for find-the-product, plus a legend for users; not a correctness proof.
Worth promoting only together with the canonical `stateNode` key (§6).
