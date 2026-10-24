# Surface philosophy

Part A is the doctrine kaitpw stated while driving `/ducts` (2026-10-19 to 10-23), distilled into rules, each with its extreme form. Part B indexes the unique homes of surface rules. kaitpw: "the name of the game is naigation navigation navigation. and first glance identity + state comprehensibility. take the philosophies to the extreme." So navigation rules come first, then identity and state, then the rest. Quotes are verbatim; dates are UTC session dates. Route evidence lives in [the ducts ledger](../features/ducts/LEDGER.md); cross-route gaps live in [the design-system ledger](../features/design-system/LEDGER.md).

## A · Doctrine

### Navigation

**N1. Move the view only when the person asks.**
"clicking an element sucks. it cuts you to a new camera, seemingly always a strange zoom, and often shows the popover right on top of where you look ... all of it is super disorienting and unpredictable." (2026-10-23). "focal point of orbit should be what you select." (2026-10-23)
Explains: click selects without moving the camera; Escape keeps the view; only F or double-click frames; the selection is the orbit pivot; a popover that opens never moves focus or orbit.
Extreme: scroll, camera, zoom, open sections and focus change only by a gesture or a named move the person made. Selecting, opening, re-reading and Pea's proposals leave the view where it was.

**N2. Give each gesture, key and glyph one meaning everywhere.**
"my mouse gestures never seem to do the same thing. sometims two fingers updown is zoom, sometimes pan" (2026-10-23). "i say bx always is a kbd of bx at its smallest size ... select is actrually the reticle/scope. the eye feels misleading." (2026-10-23)
Explains: one pointer scheme in `scene/gestures.ts`; Selection Box is the `bx` key glyph and Select is the reticle on every route; the globe keeps only the north shortcut.
Extreme: one input vocabulary for the app. A gesture in a canvas never reaches the page (no browser zoom, no page scroll), and a key does the same thing in every state and on every route.

**N3. Make every list a navigation control, and make every list the same list.**
"revit work requires tons of lists simply for navigations sake, and these are fundamentally navigation controls, and every list should look and feel the same." (2026-10-23). "both sidebar lists need search with hotkeys ... i say "/"." (2026-10-23). "we more generally also need autocomplete, because otherwise theres no way to know what you can even query for." (2026-10-23)
Explains: kit `useList` and `ListView` (virtual rows), keyword search plus picked pills, a Filter button with the same picker as completion, sticky collapsible sections, "/" focuses search.
Extreme: no collection is navigated by scrolling alone. Pickers, menus, palettes, inboxes and sidebars are one `ListView` with one row anatomy, and a keystroke paints in the next frame.

**N4. Make everything you can see reachable in one move from where you see it.**
"I should b able to get its section box in revit in one click _at the location in the ui where im interfacing with it_." (2026-10-21). "i hate adding random buttons everywhere" (2026-10-21). "these should link to the inbox maybe? they need some sort of bold focus indication too" (2026-10-23)
Explains: right-click on anything that stands for Revit elements gives Selection Box and Select; a link lands on its row; selecting a thing opens every row that names it; a help link closes help.
Extreme: every name, id, count, chip and mark is a take-me-there, to the row, to the picture and to Revit, with a strong landing mark.

**N5. Keep navigation in the address and in history.**
"every spatial navigation, either thru the minimap or on the main context, should go into history." (2026-10-21). "the duct read every time i open a new link is also kinda prohibitively unergonomic" (2026-10-21)
Explains: the viewport rides the URL; a named move pushes and a gesture replaces; readings belong to the document, not the tab, so a new link does not re-read.
Extreme: a pasted URL puts you in the same place with the same selection. Back undoes each named move and nothing else, and Pea navigates through the same address.

**N6. Never blank the world and never lag.**
"the route seems to periodically re-read ducts on its own. which makes it literally impossible to use. since it blanks out the whole page." (2026-10-22). "navigating from single system, back to all systems is slow enough that it feels like it doesn't work at first." (2026-10-23). "the lag when typing in the search bars is untenable." (2026-10-23)
Explains: retained readings across subscribers; list filtering in a transition; camera commits at release. Resource bursts publish per frame, equal values preserve identity, and URL subscribers select the fields they read. Camera motion updates the renderer and globe directly. Work solves and document-wide triage run in a worker; only results for the current inputs can arm actions. Topology caches depend on staged verdicts, not unrelated Work fields. An unchanged scene layer list does not redraw thumbnails.
Extreme: every input answers in the next frame. The old view stays until the new one is ready, a slow move shows progress and refuses repeat input, and a re-read changes only the values that changed.

**N7. Announce reach before contact.**
"many things dont have/or not clear enough when your cursor is reaching them (style problem, not raycasting)" (2026-10-23). "it also doesnt activate if u press the unit text" (2026-10-23). "if the user clicks away or escapes, then the thing should stay armed and show the active version of the button." (2026-10-23)
Explains: stronger 3D hover ("its unnecessarily sublte now, and impossible to see in miniview version"); the unit text focuses its input; preview-to-do stays armed after Escape.
Extreme: the cursor never guesses. Each target shows it is live before contact, its whole visible box is its hit area, hover reads even in a minimap, and an armed control looks armed until the person ends it.

**N8. Give every vast field a minimap.**
"Revit work requires navigating vast spaces of information, and revit itself falls very short on this. "table is the product" is one manifestation of a paradigm that fixes revits horrible navigability, minimaps are another." (2026-10-21)
Explains: the globe floater, the table minimap, the chat lens bar, the tree mini-view.
Extreme: every field large enough to get lost in shows the whole with the viewport box, and a click on the minimap is a named move.

### First-glance identity and state

**I1. Name the Subject; never print a raw id.**
"in any text block, ids are matched to a Subject, given a short human name, and given a footnote number. hover over that block would highlight all mentioned Subjects with the footnote number displayed on each." (2026-10-23). "get the incomprehensible group numbers out of he ui" (2026-10-21)
Explains: systems are picked by Revit name, never group id; ids in finding text become named Subjects with footnotes; rows are named by type; units by the firm tag.
Extreme: no bare number stands for a thing. Each reference shows its name and a footnote mark that also appears on the picture; an id appears only as a mono value in its Subject's facts.

**I2. Show critical damage on the thing itself.**
"making fans and terminals strobe glow red to indicate a missing input. kinda like a video game when its damaged ... keep this philosophjy in mind going forward" (2026-10-23). "i would like the 3d visualization of issues louder, ie always on" (2026-10-23). "the non-negotiable problems are not clear." (2026-10-23)
Explains: a red pulse on price-blocking elements; overhung edges bright red; an amber translucent box where a heal adds or caps; stage marks share identity and hover with inbox rows; a generic mark only where no geometry exists.
Extreme: blocking state reads at first glance with no hover, click or legend, as damage on the element, on the row and on the cell. Calm things stay calm, so damage is rare and loud. DOM damage stays static at rest: infinite opacity beats still incur style work despite accelerated rendering. Alarm outlines, fill and still glow retain the mark under either motion preference. Kit owns this in `lang.css`.

**I3. Stay monotone unless colour carries information.**
"im kinda enjoying the simplicity of the monotoen. im realizing now colors add no information, and might b misleading if u thought they did." (2026-10-23). "i dont want an ugly strobe of color" (2026-10-23)
Explains: the bar breakdown uses leader lines, not hues; Pea's part of a popover is pea green ("for clarity", 2026-10-20); `lens.house` law 5.
Extreme: a surface is grey until something is wrong or a specific actor acts. Each hue names its meaning in one word, the same word on every route.

**I4. Give state one fixed home; never a popover at the pointer.**
"that top left summary box should be where selection info shows. this would actually be way more ergonomic and predictable than the popovers on click. the popovers always felt a little wrong" (2026-10-23). "maybe as a chevron + selection in the main panes title so itd say like "EX 6 > RV-28". sidebar is for higher level stuff" (2026-10-23). "layers dont show any active state" (2026-10-23)
Explains: selection facts in the picture's summary box; the crumb scope › subject › selection in the pane title; active marks on modes and layers; a pending count on Write. This supersedes the 2026-10-20 lean toward an edit popover at the subject.
Extreme: a screenshot answers where am I, what is selected, what is on and what is pending, from places that never move.

**I5. Hold overlays beside the subject, in line of sight.**
"move the bar and numbers to the other side of the popover so its better on the line of sight when u look at the bar and hover it" (2026-10-23). "the bar breakdown should become a popover so it never shifts down the list ... it must be one popover." (2026-10-23)
Explains: bar popover rows face their bar; a notification is a real popover with a count; facts sit beside the projected element box.
Extreme: an overlay opens on the side away from what you look at, its nearest row faces its anchor, it moves no layout, and one overlay is open at a time.

**I6. Bind short words to marks; send explanation to the tutorial.**
"its an incomprehensible wall of text with not clear relation to anything. and it takes so much space." (2026-10-23, on the eq ft legend). "prose like this should live in tutorial." (2026-10-21). "i want to feel and use the ux" (2026-10-21)
Explains: legends are keys of mark plus word; the why lives in `route:ducts.guide` and the tutorial.
Extreme: the working surface carries no sentences. Each word sits next to the mark it names, and the why is one keypress away.

### Layout and ground

**L1. Make chrome earn its space or delete it.**
"top part of left system sidebar only trakes up space. move the info into that systems hovers and/or inputs and remove that section." (2026-10-23). "the new thread button and ctrl k kdb are just floating in space" (2026-10-23). "a separate pane/region like that is only justifiable if it dhows something another one does not." (2026-10-20)
Extreme: no header, section, frame or label repeats another place or carries no state. What remains is the subject and its controls.

**L2. Never cover the thing you navigate.**
"the tall info footer at the bottom fort he selected tree row also obsures the tree too much." (2026-10-23). "floaters should b draggable alonng the edge they're on. and resizable to certain responsive caps. the min can be pretty small, thatll be our version of hiding." (2026-10-23)
Explains: selection detail moves out of the tree to the summary box; floaters drag along their edge and shrink; panes collapse to a rail with a min and max width. A floater may overlap a neighbouring pane ("i think i like it", 2026-10-23), never its own subject.
Extreme: nothing sits over the field that the person did not put there, and everything put there moves and shrinks.

**L3. Keep layout still and edge-bound.**
"overlfows shoudl change size as minimally as spossible, and for things with 4 sides, the children inside shoudl always be hugging an edge." (2026-10-23). "they have to much layout shift within them on hover" (2026-10-23). "id rather not wrap until the very last second. inputs should simply lose their decoration and space and show it on focus" (2026-10-23)
Explains: unit inputs with an input border at rest and no hover shift; right-side row meta never covers the title; button groups truncate with an ellipsis.
Extreme: hover, focus, open, load and resize move nothing the person did not touch. At every width each child hugs an edge, similar gaps use one token, and controls shed decoration before content.

**L4. Let the ground say what is the subject.**
"sidebars should be a darker color when they are not the subject of the page." (2026-10-23). "we now need a darker hairline for stuff that has a background color like the sidebars. i cant see them anymore almost at all." (2026-10-23)
Explains: supporting sidebars recede; search and sticky heads take their own plane ("the filter area and stuck sections are the same color as this list which is kinda disorienting").
Extreme: the subject sits on the brightest ground, supports recede, and every boundary is visible on every ground.

### Primitives and method

**P1. One primitive per job, and the primitive forces the look.**
"i want my primitives to general force the same aesthetic and UX upon every route." (2026-10-20). "if its part of the primitive it should come for free no?" (2026-10-23). "the unit should be integrated intot he component" (2026-10-23)
Explains: kit `ListView` for chat, systems and inbox; `Floater`, `PlaneMinimap` and `OrbitMinimap` in `components/lang/`; the one element menu; the unit input is kit `StateCell` with `unit`. Subject text with footnotes (I1) still lives in `ducts/subject-text.ts`, so it is owed to the kit.
Extreme: a route cannot draw a list, input, popover, minimap, menu or damage mark except through the kit, so one fix lands everywhere. A route with a look of its own is a kit defect.

**P2. Show every effect that leaves the route, as one armed button.**
"its always been my intention that the situation exposes every single button that reaches outside of the route just for the sake of visibility" (2026-10-21). "for everything that needs preview then do, it should be a single button that has preview, and pressing it shows the do in the popover thing." (2026-10-23)
Explains: the Situation draws preview, write, heal and make-the-fan beside the same button in the page; secondary verbs go to the context menu ("too many random buttons evertywhere", 2026-10-21).
Extreme: the body has no effectful button of its own, and an armed effect is visible from the head until it ends.

**P3. Put configuration in Settings as a compact picker.**
"the slots should stay in settings, but it should become a picker. its far too big and disorienting right now." (2026-10-23). "picking the airflow slot from inputs pane feels super wrong." (2026-10-22)
Extreme: the working surface never hosts configuration. A setting is one picker that shows coverage, "the more compact the better, as long as it still encodes enought information to make effective decisiosn" (2026-10-23).

**M1. Serve the 80% case now and recalibrate later.**
"im really aiming for like the 80% case here i think. we can always recalibrate" (2026-10-23)
Explains: the 12 in missed-join cap is a first guess; the first set of 3D finding marks.
Extreme: no surface waits on the rare case. A constant that guesses says so in a comment and is tuned on real use.

**M2. Judge on the real page with real data.**
"its so abstract tho its hard for me to give real feedback without seeing and feeling it first." (2026-10-19). "i dont understand what this means. i want to feel and use the ux" (2026-10-21)
Extreme: no surface is judged from a description, mock or fixture alone. Each claim ships a link that opens the real state.

### Rejected, in kaitpw's words

| Pattern                                                             | Verdict                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Click cuts the camera and drops a popover on the target             | "super disorienting and unpredictable"                                   |
| A verb that opens a popover and moves the orbit                     | "state the drop is also horrible ux"                                     |
| A thin full-width notification bar instead of a marker with a count | "this is horrible"                                                       |
| A prose legend under the list                                       | "absolutely horrible ... an incomprehensible wall of text"               |
| Raw ids in finding text                                             | "incomprehensible"                                                       |
| A re-read that blanks the page                                      | "literally impossible to use"                                            |
| Search that lags per keystroke                                      | "untenable"                                                              |
| Inputs with no visible frame at rest                                | "non-standard and kinda hidden (in unfocused state u cant see anythign)" |
| Slot choice in the Inputs pane; slots as a large settings block     | "feels super wrong"; "far too big and disorienting"                      |
| Selection state in the sidebar                                      | "the wrong place for selected state"                                     |
| A hue per part in a breakdown bar                                   | "an ugly strobe of color"                                                |
| ASCII tree guides                                                   | "the ascii looks horrible"                                               |
| SVG centreline isometric as the model picture                       | "0 information to identify what your looking at"                         |
| A crude glow and plain footnotes                                    | "the glow is kinda unsophisticated, footnotes dont stand out"            |

### Checklist

Run each item in a browser on the real route with real data (M2). Each item names its principle, what to do, what to measure, and the pass condition.

| #   | Principle | Do and measure                                                                                                          | Pass                                                                                                                     |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | N1        | Read the viewport (URL `viewport` and camera pose) or `scrollTop`; click a selectable thing; press Escape; read again   | Unchanged after both; only F, double-click or a minimap click changes it                                                 |
| 2   | N1        | Open and close every popover, menu and detail on the surface; read `document.activeElement` scroll parents and the pose | No scroll or pose change                                                                                                 |
| 3   | N2        | Repeat wheel, two-finger scroll, pinch (ctrl+wheel) and drag five times, with selections and clicks between             | Same effect each time; `visualViewport.scale` stays 1; page `scrollY` unchanged                                          |
| 4   | N2        | Census icons for Select and Selection Box across routes                                                                 | Select is the reticle and Selection Box the `bx` key glyph everywhere                                                    |
| 5   | N3        | For each collection over 7 rows: press "/", type a word from a non-title field, use ArrowDown and Enter                 | Search focuses; rows filter; completion lists fields and values; keyboard moves and opens                                |
| 6   | N3, N6    | Type 5 keys in each search; measure keydown to next paint                                                               | Median under 16 ms; no visible lag                                                                                       |
| 7   | N3, P1    | Inspect each list's root                                                                                                | It is kit `ListView` (virtual rows, sticky collapsible heads)                                                            |
| 8   | N4        | Right-click every row, mesh, chip and name that stands for Revit elements                                               | Menu offers Selection Box and Select                                                                                     |
| 9   | N4        | Click every link, id, count and chip                                                                                    | It lands on its row or element with a visible landing mark                                                               |
| 10  | N5        | Make a named move, copy the URL to a new tab, then press Back in the first tab                                          | New tab shows the same view and selection; Back undoes exactly that move                                                 |
| 11  | N6        | Trigger a re-read and a slow navigation; sample frames every 50 ms                                                      | No frame shows an empty main pane; progress shows within 100 ms; repeat input refused                                    |
| 12  | N7        | Move the cursor onto each control, row and mesh; click its label, unit and padding                                      | A hover mark shows before click; the whole visible box activates; armed controls stay armed after Escape                 |
| 13  | I1        | Scan visible text (`innerText`) outside mono fact values for `/\b\d{6,9}\b/` and `/\bg\d{5,}\b/`                        | Zero matches; each reference is a named Subject with a footnote that also marks the picture                              |
| 14  | I2        | With one price-blocking finding, screenshot the surface with no hover                                                   | The blocking element, row or cell shows damage; calm findings do not pulse                                               |
| 15  | I3        | List every non-neutral computed fill and stroke                                                                         | Each hue maps to one named meaning in the key or tokens                                                                  |
| 16  | I4        | Select three different things; record where the selection name and facts appear                                         | Same fixed place each time (crumb or summary box), never a popover at the pointer; layers and modes show an active state |
| 17  | I5        | For each popover, intersect its rect with its anchor and with the selected element's projected box                      | Zero overlap; nearest row faces the anchor; one popover open; no layout shift                                            |
| 18  | I6        | Count sentences on the working surface outside help and tutorial                                                        | None; every legend is mark plus word                                                                                     |
| 19  | L1        | For each header, section and frame, compare its text with the rest of the page                                          | Each carries state or a verb that no other place shows                                                                   |
| 20  | L2        | Open every footer, floater and detail; measure the area of the navigated field it covers                                | Nothing covers the field unless the person placed it; floaters drag along their edge and shrink                          |
| 21  | L3        | Record a `layout-shift` PerformanceObserver over hover, focus, open and load                                            | Cumulative shift 0 for things the person did not touch                                                                   |
| 22  | L3        | At 1024, 1280, 1600 px and at each pane's min width, compare `scrollWidth` with `clientWidth` and title/meta rects      | No overflow; text ellipsizes; meta never overlaps the title; children hug an edge                                        |
| 23  | L4        | Sample ground colours of subject, sidebars, search and sticky heads, and each hairline against its ground               | Subject brightest; supports recede; search and heads on their own plane; every hairline visible                          |
| 24  | P2        | List every button that writes outside the route                                                                         | Each one is in the Situation; preview-to-do is one button that stays armed                                               |
| 25  | P3        | Look for configuration controls on the working surface                                                                  | None; configuration is a compact picker in Settings                                                                      |

## B · Homes of the rules

The long rationale is in git history.

### 0 · Product

- `.agents/skills/lens.house/SKILL.md` laws 2–4 hold honesty, scan speed, and the table-as-page rule.
- Candidate `lens.house` law: every product and incubating-product route is reachable from the front door; a round-scoped throwaway route may remain typed-URL-only.

### 1 · State and vocabulary

- `family/model.ts`, `components/lang/cell.tsx`, and the cell specimens hold derived state, agreement, domain order, stable facets, and the `fresh: "never"` rung.
- `components/lang/empty.tsx` and its swatch specimen hold the two empty stories and their required exits.

### 2 · Pseudo-dimensions

- `StateCellProps`, `StateColumn`, and the cell specimens hold overlays as cell state, explicit precedence, and agreement columns instead of duplicate value columns.
- The owning route state and lookup functions hold substrate switching; bulk verbs expose their far side before they enable.

### 3 · Honesty

- `.agents/skills/lens.house/SKILL.md` laws 2, 8, and 9 hold honest numbers, stand-ins, and explicit empty states.
- `VerbProps.reason`, `EmptyStateProps`, `FactChip`, `ArmingStrip`, and their specimens hold refusal, seam, provenance, and blast-radius ceremony.
- Candidate `lens.house` law: an agent may edit a portable document, but a human invokes every crossing into the live model.
- Candidate `lens.house` law: a rejected cell commit restores the prior value and states the reason beside the cell without moving the row.

### 4 · Layout and addressing

- Doctrine P2 (the route head draws every verb that leaves the route) and N4 (a link lands on its row; selection opens every row that names it and offers "show in Revit") are candidate `lens.house` laws. A collapsed diagnostics group carries a key of kind chips with counts that filters rows and picture annotations together.
- `Situation` (the one route head), `Ladder` (the target picker), `TableFrame` with `MasterTable`, and their specimens hold sentence addressing, visible narrowing, drill-in, fixed controls, and local fact placement.
- `.agents/skills/lens.house/SKILL.md` laws 1, 4, 7, and 9 hold one meaning, table modes, meaningful frames, and designed empty states.
- Spatial renderers and their measured/fixture types distinguish surveyed drawings from estimates.

### 5 · Colour and type

- `.agents/skills/lens.house/SKILL.md` laws 5 and 6 hold the meaning of colour and type.
- `base.css` owns raw values; `design-lang.css` projects them; `design-guard.test.ts` enforces the boundary; the swatch renders every tier and role.

### 6 · Primitives

- `.agents/skills/lens.house/SKILL.md` law 10 holds kit-first authoring.
- Component prop types, `design-guard.test.ts`, recipe-grid tests, and swatch specimens hold primitive capability, keyboard behavior, and variant coverage.
- Kit `ActionDefinition` and `actionScopeKeys` connect control activation, scoped bindings, and Tutorial. `KeyHint`, `PopupFrame`, and `SearchControl` own shortcut, picker, and search presentation; [normalization](../features/design-system/NORMALIZATION.md) indexes these contracts.
- `state/route-store.ts` and product manifests hold the route-visible model.
- `scene/gestures.ts` holds the one pointer scheme (N2); `scene/damage.ts` holds the damage pulse (I2); kit `useList` and `ListView` hold the one list (N3).

### 7 · Route anatomy

- Product manifests and route-store types hold the world, actions, feeds, panes, fixture lanes, and URL-owned scope.
- Candidate `lens.house` law: a route owns its world and host calls; descendants render typed state and return typed actions.
