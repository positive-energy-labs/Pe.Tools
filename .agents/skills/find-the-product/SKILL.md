---
name: find-the-product
description: Find the ideal shape of a product's UI/UX. Use for UI when clean-rooming, experimenting with variations, or when the layout, verbs, or state model are unsettled ("Find UI", "Refine UI", "UI feels wrong"). Use for logic when the underlying service/s don't serve what the dream UI needs ("Close the chain", "Finish backend", "Promote this prototype").
---

# Find the product

Help the user find their product. The immediate goal depends on circumstance but the ultimate goal is always the same: make a prod-ready product. An end-user (or you or I) must be able to drive the full workflow through the UI, end to end.

In principle, the ideal product is one that makes a hard and sprawling workflow seamless. Ideal UI shape is best discovered prototyping and should be the first step. This exercise clarifies underlying concepts and their relations, helps craft UX/UI idioms, reveals the actual problem, and uncovers where the backend falls short. Only after the consuming surface settles does creating and composing the backend carry real meaning. 

The find-the-product cycle is roughly: 1) find the UI shape, 2) promote to canon, 3) make the backend, 4) manual E2E test, 5) (later) automated E2E test. In practice shimming allows 2-4 to happen interleaved or out of order. "Code is the spec" is a tenet. Every step nudges canon code closer to the target along its relevant axis, built so shims can be slotted in during the full promotion. If the solution space does not narrow then something went wrong. 

## Glossary, in context of this skill
- Product: The UI, backend, and how the wiring feels; the thing being shaped and found.
- Backend: The supporting service/s chained into a pipeline underneath the UI. Not always literally server-side.
- Precedent: The current UI/s. Precedents indicate what the problem is; its layout is the first thing to discard. Absorb the precedents learnings and push the frontier.
- Shim: A placeholder/stub/workaround. By its nature prototyping proliferates shims, thus any shim should be made painfully obvious in the code with comments and demo-naming (e.g. "MyLens", "DemoAtlas", etc.). Shims are most deceptive in the frontend, but most painful in the backend.
- E2E test: first and lowest bar is manually driving the ui through the whole workflow. Codifying as a deterministic test is very final touches; the lift is big and it prevents iteration. When made, it should simply to prevent the chain's linkage from regressing, not cover edges.

## Process

Run the `grilling` skill on what the product *is*, goals, and scope. If no precedent exists then solving end-user stories and eliminating friction are top priority. 

Then, drive the `prototype` skill as the main loop and abide by the `delegation` skill's protocol. 

Adapt the process to the circumstance and user's goals. On grilling: questions a mock can easily answer are cheaper to prototype than to argue about, but a variant built on the wrong boundary or to answer an unasked question is a wasted builder. On prototyping: scope may be whole-route, single component, or an entire package. Be efficient and choose the harness that's closest to the final surface.

Persist per the `docs` skill: while the effort runs, the open frontier and per-round verdicts live in
`docs/features/<surface>/MAP.md`; settled laws promote to the feature's `LEDGER.md` (Decided) as they
land, and `MAP.md` dies when the effort ends. The ledger is the single home for verdicts; do not also
put them in commit messages. A settlement recorded there is design law until explicitly overruled.
What lags is the migration into older surfaces, so note in `MAP.md` which surfaces have caught up.

### Modalities

| Goal | Rule of Thumb |
|--|--|
| Finding UI | Cleanroom the precedent if it exists, speculatively fan out prototypes if not; radical experiments collapse solution space. 
| Refining UI | Variant switcher on precedent or prototypes atop a mirrored precedent. 
| Closing the Chain | Identify the backend required for the UX the UI espouses, plan with user, then build. If it outgrows one session, merge onto the main flow: `to-spec` → `to-tickets` → `implement` (see the `index` skill). This lane is untested — prefer the proven flow over inventing process here.

### Notes

- User rulings are the most important signal. Interleave grilling to understand what they actually want
- Losing the layout argument while winning the product argument is a normal outcome — a demotion no
variant could express in its own layout can still be right one level up.
- A round that retires nothing produced no information.

## Building a UI round

Gather context from `docs/features/<surface>`, align on the design system and component library, and absorb the precedent when it exists. **Invoke the `prototype` skill (UI branch).** What this skill adds:

- **Dream big, rounds should overreach**, especially round 1. A variant pruned for feasibility teaches nothing. Reframes that retire a UI idiom only come from variants built in ignorance of the current frame. 
- **Use real data**. Variants that seed their own mock data compare data instead of structure; this may render entire rounds useless. Real data changes verdicts that placeholders can't reach. Scaffold the environment that all threads need. If using fixture data, it should not limit protos, it's only a start point. Note where protos seed their data and what this says about the product.
- **Import the real components/primitives** when the primitive itself is not in question. A hermetic prototype proves nothing and variants built on canon primitives audit them for free. Record every gap as a comment at the call site — and one Owed line in `docs/features/design-system/LEDGER.md` naming this route (the cross-route rule: the design-system ledger owns primitive gaps; routes cite it).
