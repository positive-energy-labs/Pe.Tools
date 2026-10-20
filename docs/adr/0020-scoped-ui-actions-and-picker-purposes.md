# Scoped UI actions and picker purposes

## Context

Table navigation handled keys outside the shared registration path. Tutorial could not discover those behaviors. Context-menu callbacks and shortcut hints had no common action identity. Table filters reused list rows while bypassing the picker frame, its sizing, and its Escape behavior. A cell anchor selected the sizing intended for text autocomplete.

## Decision

Kit `ActionDefinition` describes a UI action once. `actionScopeKeys` adapts it into the existing scoped hotkey registry. `invokeAction` owns call-time admission for controls and keys. Tutorial reads registered action identities and descriptions. Kit `KeyHint` renders the same bindings in menus and controls. Native editing and clipboard events remain thin adapters where the browser owns the interaction.

Route domain actions adapt to this UI contract. The kit does not depend on route handles, domain operation lifecycles, or a second writable action registry.

`PopupFrame` sizes by `PopupPurpose`, independently of its anchor. Menus, pickers, autocomplete, and workbenches share one surface. `List` and `useCollection` own keyboard navigation, levels, search, and Escape. Final choices dismiss the host; intermediate choices advance the ladder. Typed creation belongs to the level that accepts a value.

`SearchControl` owns the persistent search frame, glyph, ground, and focus treatment. Table queries and picker searches compose inside it.

## Consequences

Menu hints and Tutorial descriptions derive from executable bindings. Cell navigation participates in discovery. Controls must not add a chord label without a real binding. Picker consumers choose a purpose and compose the shared behavior rather than rebuilding a popover. The design-system table specimen exercises these contracts with read-only and editable fixture cells.
