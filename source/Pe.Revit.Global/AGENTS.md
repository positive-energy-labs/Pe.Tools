# Pe.Revit.Global

## Scope

Owns durable, cross-feature Revit-side building blocks with emphasis on document-centric helpers, document/session infrastructure, host-facing document context, and reusable collectors that are broader than one feature package.

## Purpose

`Pe.Revit.Global` should be the closest shared home for document-owned Revit behavior. If logic can be expressed from a `Document`, `View`, or stable cross-feature Revit concept without feature-specific policy, it should usually land here before higher packages copy it.

## Critical Entry Points

- `Revit/Documents/` - preferred home for document-owned extension surfaces such as identity, path, and binding helpers.
- `Revit/Documents/RevitUiSession.cs` and `UIApplicationDocumentSessionExtensions.cs` - explicit current-session and `UIApplication` document-session helpers.
- `Services/Document/DocumentManager.cs` - session-aware document/open/active/MRU coordination.
- `Services/Host/RevitDataRequestService.cs` - bridge-backed document query and summary shaping.
- `Services/Host/BridgeDocumentNotifier.cs` - active/open document invalidation payloads.
- `Revit/Lib/` - reusable collectors and Revit-domain helpers that should stay broader than one caller.

## Validation

- Do not build unless the user asked; RR debug hot reload is too expensive to break casually.
- Prefer proving document-owned refactors by collapsing duplicate logic and updating focused callers before broader namespace churn.
- When a helper only needs `Document`, keep it free of `UIApplication` assumptions so host routes, scripting, tests, and feature packages can all reuse it.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **document-owned** | Behavior derivable from a specific `Document` without active/open UI session state | Prefer extension methods or small document-centric helpers; avoid putting it behind session singletons |
| **document session** | Open/active/UI-tab state for documents in the current Revit process | Prefer `DocumentManager` or `UIApplication`-adjacent helpers; avoid mixing it into pure `Document` helpers |
| **document key** | Canonical identity string for an open Revit document used by host payloads, caches, and matching | Prefer one shared implementation; avoid per-caller variations |
| **collector** | Live-document read path that returns a catalog, list, context, or other query result | Avoid using it for durable captured state |
| **apply** | Write compatible shared structures back into live Revit | Avoid mixing feature policy into low-level apply helpers unless the concept is truly feature-owned |

## Living Memory

- If a helper only needs `Document`, default to a `Document` extension under `Revit/Documents/` before adding more static manager methods.
- Keep `DocumentManager` focused on session-aware behavior: active/open document state, window handles, MRU tracking, and related UI coordination.
- Document identity, document path, and project-parameter binding enumeration should not have multiple implementations.
- Reusable collectors belong here only when the concept is stable across features. Feature-specific semantics still belong with the owning feature package.
