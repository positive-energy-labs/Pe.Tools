---
name: find-the-product
description: Find the shape of a UI surface by building rival mock routes and ruling on them. Use when clean-rooming a route, exploring the landscape of solutions for a page, or when a surface's layout, verbs, or state model are unsettled.
---

# Find the product

The shape is found by building several real routes over one fixture and having the user rule on
them. Prose specs written before the mocks have not survived contact here; verdicts recorded after
them have.

## Before round 1

Read [`docs/design/SURFACE-PHILOSOPHY.md`](../../../docs/design/SURFACE-PHILOSOPHY.md) — the
positions three clean rooms have already settled, including the acceptance bar every variant is
judged against. Variants start from there. Then:

- [`docs/design/COLOR-ROLES.md`](../../../docs/design/COLOR-ROLES.md) — variants consume role tokens.
- [`docs/features/web-primitives/THEMES.md`](../../../docs/features/web-primitives/THEMES.md) — what
  the primitives can already do and what is missing.
- The **precedent**: the surface this one replaces, and its `docs/features/<surface>/`. Every surface
  here was clean-roomed off an older one. A precedent teaches you what the problem is; its layout is
  the first thing to discard. The tell that you have a precedent rather than a product is that
  listing what confuses people about it is faster than listing what it does.

Run the `grilling` skill on scope, boundaries, what the product *is*, and what the agent may touch,
before building — a variant built on the wrong boundary is a wasted builder. Questions a mock can
answer (layout, density, legibility, affordance) are cheaper to build than to argue about.

Open `docs/features/<surface>/CLEANROOM.md` as the living doc — settled decisions, open frontier, one
section per round. It is the single home for verdicts; do not also put them in commit messages. A
settlement recorded there is design law from the moment it is ruled — what lags is the migration into
older surfaces, so say in the header which surfaces have caught up.

## Building a round

**Invoke the `prototype` skill (UI branch) and follow it** — it owns the mechanics: throwaway
from day one, `?variant=` switching, structurally-different variants, no persistence, capture on
a throwaway branch at close. What this repo adds on top:

- **Four or five variants in round 1**, not three. Round 1 answers "what is this page" — a table, a
  queue, a tree, a document, a spatial view — and exists to kill whole families of idea.
- **One shared fixture with real data**, at `src/<surface>/proto/world.ts`. Variants that seed their
  own mock data compare data instead of structure; we have done this and the round was weaker for it.
  Real geometry and real record counts change verdicts that placeholder rectangles cannot reach.
  Where the fixture is silent on something, write that down — a silent fixture produces confident
  wrong verdicts.
- **Isolate the variable.** The sharpest round we ran changed only the token scope around identical
  specimen markup, so the judgement could not be confounded.
- **Import the real primitives.** A hermetic prototype proves nothing about the components you ship.
  Variants built on the canon primitives audit them for free: every gap becomes a comment at the call
  site, which is a precise backlog you get for nothing.
- **Reuse the existing switcher** at `src/family/proto/switcher.tsx` — generic, arrow-key, DEV-gated,
  and deliberately styled unlike the design system so it never reads as part of the page under
  review. Do not re-derive it per round.
- **Round 1 should overreach.** A variant pruned for feasibility teaches nothing, because you never
  learn what you were giving up. The reframes that retire a whole UI idiom across every future
  surface only come from variants built as if the current framing were not real.
- Expect roughly 8:1 lines discarded to lines promoted. That is the method working.

Run it with `pnpm -C source/pe-tools --filter @pe/web run dev` (port 3000), or the `web-only` entry in
`.claude/launch.json`. Check whether a dev server is already up first — two that take over the host
fight each other.

### The builder brief

One builder per variant, in parallel. Each brief carries:

1. **The variant's assignment** — its thesis in one sentence, plus the other four theses so it knows
   what it must not converge on.
2. **The one question this round answers.** Everything else is the builder's judgement.
3. **The fixture path**, shared and read-only. Builders do not edit shared files — parallel writes
   collide.
4. **Import the canon primitives; comment every gap at the call site.**
5. **Return, besides code: what the state model could not express.** Builders do not report this
   unless asked, and the convergence across builders is the most valuable output of the round.

## Ruling

The user drives the variants live. Record in `CLEANROOM.md`:

1. **What won and why** — the specific property, not a preference.
2. **What retires.** Losers are deleted at the close of the round that ruled on them. Not left behind
   a flag: we currently carry ~3,700 lines of ruled-dead variants still mounted, and they are the
   only consumers of a primitive API that therefore looks used.
3. **What each loser donated.** Naming it is how the winner knows what it owes — then check the code,
   because we have both under-credited a donation and silently dropped one during the merge.

A loser that donated nothing was too similar to the winner: a note about your round, not about the
variant. A round that retires nothing produced no information.

Losing the layout argument while winning the product argument is a normal outcome — a demotion no
variant could express in its own layout can still be right one level up.

## Between rounds

Deltas shrink: whole-page shapes, then which emphasis wins, then affordances and cell states inside
the winner. The last kind is cheap and is where the surface gets good.

**The frontier is empty when every open question in `CLEANROOM.md` is either settled or explicitly
deferred with an owner.** That is the exit condition — not a round count. Ours ran to five.

The previous round's winner is the next round's baseline, including across clean rooms, which is why
the next surface starts from the philosophy doc rather than from zero.

## Closing out

The winner goes canon-track: absorb the donations, migrate onto the canon primitives, delete the
fork, delete the losers. Then fold the durable findings into
[`docs/design/SURFACE-PHILOSOPHY.md`](../../../docs/design/SURFACE-PHILOSOPHY.md) — that document is
this loop's accumulated output, and a round that changed nothing in it settled less than it thinks.

A winner blocked on something upstream — a host op that does not exist, a schema that has not
converged — still goes into the philosophy doc. Its findings are settled; only its ship date is
waiting. Record the blocker in `SHIMS.md`, not as a caveat on the design.
