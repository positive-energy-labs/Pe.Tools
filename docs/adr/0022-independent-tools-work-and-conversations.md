# Tools, Work and conversations have independent identities

## Context

Thread-owned document targeting introduced mandatory `?thread` carry in September 2026. Work was already keyed by document or workspace. Browser Places and Pea's view leases later reused the conversation as their container. Opening a tool therefore chose or created a chat even when the user only wanted the tool.

Kaitpw rejected that coupling on 2026-10-25. Conversation identity remains necessary for transcript continuity and Pea's current turn. It does not identify authored Work or a browser workspace. This decision replaces thread ownership of browser Places. [ADR 0021](0021-one-access-switch-and-document-targets.md) still governs native authority.

## Decision

Tool routes work without a conversation. Their document comes from an explicit URL pin or the sole eligible user document, never the selected chat. Opening a tool does not create a chat. First Send may create one while keeping the tool visible.

Each browser window owns its Places in sessionStorage. A thread press opens the conversation with tools collapsed. It preserves the window's Places. A Work press preserves the selected conversation and restores a matching Place's Page, or opens a new Place. Work keys and stored bodies do not change.

Chats remember explicit Work references independently of tab state. Viewing or linking Work never changes document targets or grants native permission. Closed-document Work remains inspectable under its original identity.

Pea opens a tool through an explicit transient command addressed to the conversation currently shown by the browser. Acquisition identifies that command before a Page patch can succeed. Old events and unrelated conversations cannot open a tool.

## Consequences

A tool link can travel without a local conversation identifier. Its document and Work may still require local files, exact open lifetimes or host storage; removing `thread` does not make those resources portable.

Historical thread tabs remain readable as evidence for remembered Work context. They do not control browser navigation. No new host workspace store replaces them. Browser-window loss may lose Places, but never authored Work or conversation history.
