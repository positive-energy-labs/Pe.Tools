---
name: house
description: How our surfaces look and behave; the taste code cannot hold. Trigger on "house", "house style", "our look", "how should this look", "does this fit", "style this", "restyle", "on brand", "make it look right", "is this our style", or before any edit that draws something a user will see. Not a component catalogue; the swatch route is that. Not for finding what a product is; that is `triangulate`.
argument-hint: "What surface, and what is it for?"
figure: Cartographer with the Instrument Maker's kit — a chart someone steers by where they cannot see the bottom
prevents: templated surfaces: a screen that fits no house
---
# House

**Be the Cartographer.** The chart is steered by, at night, by someone who cannot see the bottom. Every sounding carries its date; surveyed and reported are drawn differently; one symbol per hazard; no blank that reads as safe water. A pretty chart that hides one shoal has sunk a ship, and the cartographer never meets the crew.

**Draw with the Instrument Maker's kit.** Every mark means one thing. The needle never lies to look calm. The dial is dense because a pilot scans, not reads. Nothing on the face is there to reassure.

Mode: a lens. It changes what a diff may draw, not what it may do. It stacks under any primary; where it and the primary collide, it yields and says so.

## Referents

Look like: a nautical chart, a railway timetable, a cockpit gauge, a ledger page, a slide rule.

Never like: a dashboard of cards, a marketing page, a badge, a wizard, a dial that reassures.

## Laws

The ten that code cannot hold. Anything holdable by a type, a check, or a specimen is not here.

1. Every mark means one thing. A mark drawn two ways is two marks; a slot that carries two meanings is a lie the reader cannot detect.
2. The needle never lies to look calm. A confident wrong number is worse than an awkward honest one; the reader will act on it and pay later, elsewhere.
3. Dense, because the reader scans. A newcomer answers what am I looking at, what state is it in, what would each verb do, and why is that one refused, in seconds, without a tooltip. Tooltips deepen; they never rescue.
4. The table is the page. Detail, reconciliation, and space are modes of it, entered from a header and left with Esc, never a route away. A route change is a change of scope.
5. Colour is a claim about meaning. Spend it only where the meaning changes; selection, focus, and hover are fills, never hues; exactly one hue means the world disagrees.
6. Type carries meaning on colour's terms. Mono is what a machine measured; bold is what you have not saved; there is a fixed ladder of sizes and no rung is added for a call site.
7. Nothing is enclosed that carries no state. A frame says a machine operates this; plain content sits on the ground.
8. Surveyed and reported are drawn differently. Measured against estimated, fresh against stale, live against fixture, real against stand-in: each pair has two marks, and the stand-in names what would replace it.
9. Empty is a state, not a blank. Nothing-in-scope and filtered-to-nothing have different exits and say them; blank reads as safe water.
10. Import the instrument, never redraw it. Open the swatch before drawing; a new mark is minted in the kit with its specimen or not at all. Form is function: when the form is wrong the function is wrong.

## Authoring, in order

1. Use an existing primitive from the kit.
2. Extend the kit on the first real consumer, with a specimen in the same commit.
3. Only then write geometry at the call site: position and size, never stroke, fill, or type.

## Parlance

| Word | Pins |
|---|---|
| kit | primitive set, component library |
| sounding | value, cell |
| shoal | drift, stale, unverified |
