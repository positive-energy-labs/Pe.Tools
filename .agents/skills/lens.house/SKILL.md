---
name: house
description: How our surfaces look and behave; the taste code cannot hold. Trigger on "house", "house style", "our look", "how should this look", "does this fit", "style this", "restyle", "on brand", "make it look right", "is this our style", or before any edit that draws something a user will see. Not a component catalogue; the swatch route is that. Not for finding what a product is; that is `protoui`.
argument-hint: "What surface, and what is it for?"
figure: Cartographer, a chart someone steers by where they cannot see the bottom
prevents: "templated surfaces: a screen that fits no house"
---
# House

**Be the Cartographer.** Someone steers by the chart at night and cannot see the bottom, and the cartographer never meets the crew it sinks. You may not leave a rock off the chart for want of room or to keep the sheet clean: a crowded sheet gets an inset, never a patch of empty sea. A request for a cleaner sheet removes ink, never a hazard.

This skill is a lens. It changes what a diff may draw, not what the diff may do. It applies under any primary skill, and where it collides with that skill, it yields and says so.

## Referents

Look like: a nautical chart, a railway timetable, a cockpit gauge, a ledger page, a slide rule.

Never look like: a dashboard of cards, a marketing page, a badge, a wizard, a dial that reassures.

## Laws

These are the ten rules code cannot hold. A rule that a type, a check or a specimen can hold does not belong here.

1. Every mark means one thing. A mark drawn two ways is two marks. A slot that carries two meanings misleads the reader, and the reader cannot detect it.
2. Never show a confident wrong number. An awkward honest number is better, because the reader acts on the number and pays for the error later, somewhere else.
3. Make it dense, because the reader scans. A newcomer answers "what am I looking at, what state is it in, what would each verb do, and why is that one refused" in seconds, without a tooltip. Tooltips add depth. They never rescue an unclear surface.
4. One route asks one question about one kind of subject. A different subject noun is a different route, linked by a deep link that carries the subject. A stage is a mode of the same subject, and a person can always pick it. The table is the page: detail, reconciliation and space are modes of it, entered from a header and left with Esc.
5. Colour is a claim about meaning. Spend it only where the meaning changes. Selection, focus and hover are fills, never hues. Exactly one hue means the world disagrees.
6. Type carries meaning the same way colour does. Mono is what a machine measured. Bold is what you have not saved. The size scale is fixed, and no size is added for one call site.
7. Enclose only what carries state. A frame says a machine operates this. Plain content sits on the background.
8. Draw measured and estimated values differently. Measured against estimated, fresh against stale, live against fixture, real against stand-in: each pair has two marks, and the stand-in names what would replace it.
9. Empty is a state, not a blank. Nothing-in-scope and filtered-to-nothing have different exits, and each says its exit. A blank reads as "nothing wrong here".
10. Import the component; never redraw it. Open the swatch route before you draw. A new mark is added to the component library with its specimen, or not at all. When the form is wrong, the function is wrong.

## Authoring, in order

1. Use an existing primitive from the component library.
2. Extend the component library on the first real consumer, with a specimen in the same commit.
3. Only then write geometry at the call site: position and size, never stroke, fill or type.
