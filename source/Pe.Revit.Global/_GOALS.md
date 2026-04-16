# Pe.Revit.Global

## North Star

WIP: this package is still being shaped.

Make `Pe.Revit.Global` the home for durable, cross-feature Revit concepts that should be reusable across commands, host-backed queries, scripting, tests, and feature packages.

It should deepen the repo around document-centric and element-centric mechanics so higher-level packages can compose meaningful workflows without re-owning raw Revit traversal, collection, or apply logic.

## User Goals

- Make document insight and common Revit operations feel consistent across tools and workflows.
- Let different features surface the same underlying document concepts without contradictory behavior.
- Reduce cases where the same Revit object is interpreted differently depending on which command or feature touched it.

## Developer Goals

- Centralize generally applicable document, selection, family, schedule, electrical, and element-context concepts close to shared Revit infrastructure.
- Prefer deep reusable modules over one-off collectors or helpers embedded in commands.
- Prefer document-owned entrypoints for reusable collect/capture/apply seams, even when a feature package still owns the returned models.
- Grow from collectors into counterpart capture/apply helpers only when the concept is stable beyond one feature.
- Keep feature packages focused on semantic intent and workflow policy, not raw Revit traversal or boilerplate document mechanics.
- Work well with `Pe.Revit.Extensions` as the sharper home for validated wrappers and high-value extension surfaces such as `FamilyDocument`, `FamilyManager`, and parameter helpers.

## Integration Goals

- Provide reusable Revit-side building blocks for `Pe.Host`, `Pe.Revit.Scripting`, `Pe.App`, tests, and feature packages.
- Offer document-context and element-context concepts that can support both host endpoints and direct scripting without forcing each caller to rediscover the same patterns.
- Make cross-feature concepts portable enough that a collect/capture/apply surface proven in one workflow can be adopted by another without dragging feature-specific semantics with it.

## Non-Goals

- Do not become a dumping ground for miscellaneous helpers with no stable concept behind them.
- Do not absorb feature-owned semantic models merely because they touch Revit.
- Do not absorb feature-owned snapshot or apply models before the concept is proven broader than one feature.
- Do not chase completeness by wrapping the entire Revit API.
- Do not move unstable experiments here before the concept has proven broader than one caller.
