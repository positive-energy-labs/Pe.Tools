# Design normalization

The durable surface rules are indexed in [SURFACE-PHILOSOPHY.md](../../design/SURFACE-PHILOSOPHY.md). Raw values live in `base.css`, projection lives in `design-lang.css`, semantics live in `components/lang`, specimens live on `/design-system/swatch`, and enforcement lives in `tests/repo-guards/src/design-guard.test.ts`.

Actions shared by keys and controls use kit `ActionDefinition`. `actionScopeKeys` projects their bindings into the existing scope tree. `invokeAction` checks availability at invocation time for every input path. Tutorial reads registered action identity and descriptions; menus render bindings through kit `KeyHint`. Navigation and editing are actions too. Native text, clipboard events, and editor adapters retain their platform behavior.

`PopupFrame` owns picker presentation. `PopupPurpose` chooses sizing independently of the anchor: `menu`, `picker`, `autocomplete`, or `workbench`. `List` and `useCollection` own search, cursor, levels, and Escape. A level may create typed values with `Level.onCreate`; intermediate levels do not offer creation. A final choice dismisses its host. Empty breadcrumb labels do not draw an empty band.

List row metadata carries short facts: counts, types, state, priority or shortcuts. The optional description explains the item and must not repeat metadata. `List` renders that area only when the cursor item supplies distinct content. Empty descriptions and footers have no reserved space or separator. Column explanations belong on the column header's floating hint, not in its filter picker's footer.

Picker widths stay within 18–20rem and shrink to the available viewport. Description content does not participate in intrinsic width. It wraps long tokens and clamps to two lines; its floating hint exposes the full text. Width belongs to `PopupFrame` purpose sizing, never to a caller's description.

`SearchControl` owns the persistent search frame, search glyph, ground, and focus treatment. Query chips and picker inputs compose inside it. Call sites choose geometry and provide state; they do not redraw its appearance.

`QueryVocabulary.filters` names domain conditions with a label, explanation and canonical clause. A `default` marks a starting condition; it never applies an invisible predicate. The caller seeds its query with `defaultFilterQuery`. Chips, picker toggles and restoration project and edit that same query. Clearing it removes defaults too; restoration preserves other authored conditions. Domain evaluators remain with the owning route.
