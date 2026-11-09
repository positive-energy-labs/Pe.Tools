---
name: protoui
description: Find the shape of a product surface by building comparable variants. Trigger on "protoui", "parallax", "find the product", "variants", "find UI", "refine UI", "UI feels wrong", "which layout", "prototype", clean-rooming a precedent, or when the user is circling what a product *is*. Not for backend or API shape; that is `muse` or `close`.
argument-hint: "What surface, what's unsettled, what precedent?"
stop: two dry rounds
figure: Lineup, where the witness picks and the officer never does
prevents: "wrong product: canonizing a surface nobody felt"
---
# protoui

**Stage a Lineup.** The officer does not pick: the suspects stand in the same light, against the same height marks, and the witness picks one, or none, or the jaw from three with the eyes from five. You may not tell the witness which suspect you favour before they choose, and you may not stage a lineup of one. The officer never sends a suspect home before the witness has seen them.

The UI comes first because it is the cheapest way to find what a user might want. It clarifies nouns, shows the real problem, and shows where the backend falls short. When the surface settles, `close` makes the backend real.

## Laws

- Make variants structurally different: layout, hierarchy, primary affordance. When drafts converge, redo one under a prohibition ("no card grid"). A difference in colour alone does not count.
- Overreach. Round 1 includes one variant past feasibility, and you prune none for that reason. The user cuts it, never you.
- Build on the real base: real components, real data, mounted in or beside the host page. Never rebuild proven production code inside a variant. Import it, and record each gap it exposes as Owed.
- Compare under the same conditions: side by side, or one param and a switcher.
- Variants are throwaway from day one, loudly named, with no polish.
- A variant that does not render is not in the lineup. A variant the user cannot open and click gets no verdict, so fix the render before you report the round.
- Report a round as one table the user can answer with `pros:` / `cons:` per named variant. The verdict comes back in that shape.
- A round that retired nothing and narrowed nothing produced no information. Reshape the next round.

## Loop

A round is: build variants, the user decides, record the verdict, reshape. Use `grill` on what the product is, interleaved with rounds and not as a gate, because a question a variant can answer is cheaper to build than to argue. Use `delegate` when the variants are many. The user sets how many.

User verdicts are the strongest signal. It is normal to lose the layout argument and win the product argument. Persist per `docs`: the open decisions and per-round verdicts stay in the live map, and settled rules are promoted. The winner is rewritten as production code, never promoted as it is, or it is recorded as a combination of variants. The round's losers are thrown away.

Mounting, the switcher bar and cleanup follow, scoped to this repo. A standalone page variant, for a question about one widget or interaction, is `page`.

## Mounting [scope: repo]

Prefer an existing host page. Variants render on the same route, gated by `?variant=`. Data fetching, params and auth stay, and only the rendered subtree swaps. A throwaway route (project routing conventions, named `prototype-*`) is a last resort, because an empty route hides problems a populated one exposes.

```tsx
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

A shared `<Header>` is fine. A shared `<Layout>` defeats the comparison.

## Switcher bar [scope: repo]

The switcher is a fixed, bottom-centre, constant-width pill: a ← arrow, a `B — Sidebar layout` label, and a → arrow that wraps. The arrows update the URL param through the router, so the view is shareable and survives reload. Arrow keys cycle too, except when an input, textarea or contenteditable has focus. Make it look foreign to the page, so it reads as not part of the design. Gate it out of production builds. Build it once, as one shared component in the project's shared UI.

## Cleanup [scope: repo]

The winner is rewritten into production code to production standard. The losers, the switcher and throwaway routes leave main. Keep the full round on a throwaway branch only if the user's verdicts lacked confidence.
