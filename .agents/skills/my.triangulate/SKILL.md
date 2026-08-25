---
name: triangulate
description: Find the shape of a product surface by building comparable variants. Trigger on "triangulate", "parallax", "find the product", "variants", "find UI", "refine UI", "UI feels wrong", "which layout", "prototype", clean-rooming a precedent, or when the user is circling what a product *is*. Not for backend or API shape; that is `demiurge` or `close`.
argument-hint: "What surface, what's unsettled, what precedent?"
---
# Triangulate

**Stage a Lineup.** Suspects stand in the same light, same height marks, same distance; the witness picks one, or none, or "the jaw from three with the eyes from five". One variant is a portrait; three, a keypress apart, are a fix on the product. Think Pareto front, not winner: the round retires what is dominated and keeps what trades.

The UI comes first because it is the cheapest way to surface what a user might want. It clarifies nouns, reveals the real problem, and shows where the backend falls short. When the surface settles, `close` makes the backend real.

## Laws

- Structurally different: layout, hierarchy, primary affordance. Converging drafts get one redone under a prohibition ("no card grid"). Color is wallpaper.
- Overreach, round 1 especially. A variant pruned for feasibility teaches nothing.
- Real base: real components, real data, mounted in or beside the host page. Never rebuild proven canon inside a variant; import it and record each gap it exposes as Owed.
- Same light: side by side, or one param and a switcher. Nothing compared under different conditions.
- Throwaway from day one, loudly named, no polish.
- Renders or it is not in the lineup. A variant the user cannot open and click drew no verdict ("Fix, I cant review"); fix the render before the round is reported.
- A round reports as one table the user can answer with `pros:` / `cons:` per named variant; the ruling comes back in that shape.
- A round that retired nothing and narrowed nothing produced no information. Reshape the next round.

## Loop

Round: build variants, user rules, record verdict, reshape. `grill` on what the product *is*, interleaved, not as a gate; a question a variant can answer is cheaper built than argued. Under `delegate` when variants are many; width is the user's call.

User rulings are the top signal. Losing the layout argument while winning the product argument is normal. Persist per `docs`: frontier and per-round verdicts live; settled law promotes; the winner is rewritten to canon, never promoted as-is, or captured as chimeras; the set's losers are thrown away.

## Mechanics

### Mounting

Prefer an existing host page. Variants render on the same route, gated by `?variant=`; data fetching, params, and auth stay, only the rendered subtree swaps. A throwaway route (project routing conventions, named `prototype-*`) is a last resort; an empty route hides problems a populated one exposes.

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

Shared `<Header>` fine; shared `<Layout>` defeats the point.

### Switcher bar

Fixed bottom-centre, constat-width pill: ← arrow, `B — Sidebar layout` label, → arrow, wrapping. Arrows update the URL param via the router (shareable, reload-stable). Arrow keys cycle too, except when an input, textarea, or contenteditable is focused. Visually alien to the page so it reads as not-the-design. Gated out of production builds. One shared component, with the project's shared UI.

### Isolated HTML variants

For component-ey questions (a widget, an idiom, an interaction in isolation): one file, no framework, no server, opens by double-click, survives being emailed. Domain language on every label. Title and one-line question at top, variants side by side or tabbed. Real logic in a pure `<script>` module the page calls into; the shell is throwaway.

### Cleanup

Winner folds into canon, rewritten to prod standard. Losers, switcher, and throwaway routes leave main; the full set commits to a throwaway branch as primary source.
