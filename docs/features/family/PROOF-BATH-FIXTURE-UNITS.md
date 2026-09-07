# Bath Fixture Units association repair

## Scope

This slice starts from `0fdf8f7872091a8dcab83587c2c8379eaaa9543f` and addresses the wave 21 `c-bath-shower` failure before `PositionAndAlign`: Revit refused the authored `Fixture Units` connector association. It does not change capture code or run Revit.

## Root cause

The bath model authors three pipe connector associations from `Fixture Units` to `PE_P_LoadCalc_CWFU`, `PE_P_LoadCalc_HWFU`, and `PE_P_LoadCalc_DFU` (`c-bath-shower.family.json:62-66`). These source definitions are shared `Number` parameters, authored as type parameters, with no formulas. Reconciliation adds parameters at step 5, places nested content at step 14, and creates connectors at step 16 (`FamilyReconciler.cs:459-499`), so the source parameters exist before association. The native `puck.rfa` parameters are unrelated placement inputs.

Revit exposes two pipe connector built-ins with the same display name:

- `RBS_PIPE_SYSTEM_FIXTURE_UNIT_PARAM`: `"Fixture Units"`, a calculated system result.
- `RBS_PIPE_FIXTURE_UNITS_PARAM`: `"Fixture Units"`, the connector input that accepts the family association.

`MakeConnectors` used `LookupParameter("Fixture Units")`. Name lookup could therefore return the calculated system result, and `FamilyManager.CanElementParameterBeAssociated` correctly refused it. This is an identity-selection defect rather than a definition-scope, formula, or ordering defect.

## Repair

For the exact authored field `Fixture Units` on pipe connectors, `MakeConnectors` now resolves `RBS_PIPE_FIXTURE_UNITS_PARAM` by built-in identity. Every other connector association retains the existing authored-name lookup. No association is skipped or dropped.

The existing bath native behavior test now verifies that all three input built-ins are associated to their authored CWFU, HWFU, and DFU family parameters. It deliberately reads the native connector identity rather than capture output, leaving the capture-safe lane untouched.

## Validation

- **Compile:** `dotnet build source\Pe.Revit.Tests\Pe.Revit.Tests.csproj -c Debug.R25.Tests -nologo` — exit 0, 50 warnings, 0 errors.
- **Native:** open. The next controlled Revit run must execute `Bath_nested_instances_follow_authored_host_geometry`; compilation does not prove Revit accepts the association.

No Revit lifecycle action, root-tree edit, fixture-byte change, MAP/LEDGER edit, or capture-source edit was performed.
