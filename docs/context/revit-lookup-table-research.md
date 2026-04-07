# Revit lookup tables research and FF integration notes

_Date: 2026-04-06_

## Scope

This document captures Revit lookup-table research and proposes an FF-oriented feature shape that should now be mapped onto the current repository structure, naming migration, and active diff in `Pe.Tools`.

## What Revit lookup tables are

Revit lookup tables are family-embedded CSV datasets used by the `size_lookup(...)` family formula function.

High-confidence findings:

- Lookup tables are used for pipe and conduit families in Autodesk docs, but practical/community material indicates the mechanism can be used more broadly in families if the formulas are set up correctly.
- Since Revit 2014, lookup table data can be imported into and stored inside the family, instead of depending only on an external CSV at runtime.
- Revit exposes API support for importing/exporting/querying embedded tables through `Autodesk.Revit.DB.FamilySizeTableManager` and related classes.
- `size_lookup` can return values from a specified column when lookup keys match the row.
- Lookup is positional for key columns: Revit ignores the first CSV column during matching, then uses the 2nd/3rd/etc columns in the order passed to `size_lookup`.
- Revit ignores header names when matching lookup keys; header names matter for the returned column reference and for unit/type declaration, but not for key matching.

## Relevant Revit API shape

### `FamilySizeTableManager`

API docs describe this as the manager for importing, exporting, and querying size data through `FamilySizeTable`.

Important members:

- `CreateFamilySizeTableManager(Document document, ElementId familyId)`
- `GetFamilySizeTableManager(Document document, ElementId familyId)`
- `ImportSizeTable(Document document, string filePath, FamilySizeTableErrorInfo errorInfo)`
- `ExportSizeTable(string tableName, string filePath)`
- `GetAllSizeTableNames()`
- `GetSizeTable(string name)`
- `HasSizeTable(string name)`
- `RemoveSizeTable(string name)`

### `FamilySizeTable`

Can inspect embedded data:

- `NumberOfColumns`
- `NumberOfRows`
- `GetColumnHeader(index)`
- `AsValueString(...)`

### `FamilySizeTableColumn`

This is the biggest clue for your validation model:

- `Name`
- `GetSpecTypeId()`
- `GetUnitTypeId()`

This strongly suggests lookup tables are not just raw CSV strings after import; Revit parses headers into typed/spec-aware columns. That supports building a higher-level abstraction that validates spec/unit compatibility before writing CSV.

### `FamilySizeTableErrorInfo`

Useful for import validation / diagnostics:

- `FamilySizeTableErrorType`
- `FilePath`
- `InvalidColumnIndex`
- `InvalidHeaderText`
- `InvalidRowIndex`

This suggests an FF validation story with two layers:

1. **preflight validation** in FF before CSV generation/import
2. **Revit import validation** surfaced back to users/tests as structured diagnostics

## `size_lookup(...)` formula behavior

Autodesk docs describe the syntax as:

`result = size_lookup(LookupTableName, LookupColumn, DefaultIfNotFound, LookupValue1, LookupValue2, ..., LookupValueN)`

Important behavior:

- The first CSV column is a row label/identifier and is skipped during matching.
- Matching uses the first lookup key against CSV column 2, second key against column 3, etc.
- `LookupColumn` identifies which column value to return.
- `DefaultIfNotFound` is returned when no row matches.
- Autodesk docs are inconsistent on whether `size_lookup` returns only numeric values or numeric + text values.
  - Older Autodesk page/search excerpt says numeric only.
  - Newer 2026 page says numerical **and text** values.
  - Your note that string return is only available via lookup tables is directionally consistent with later docs and community practice.

### Practical inference

Treat **string return support as real**, but guard it with tests because Autodesk documentation has been inconsistent across releases.

## CSV/header structure

Autodesk’s CSV structure docs say lookup table headers are formatted as:

`ParameterName##ParameterType##ParameterUnits`

Documented acceptable lookup-table parameter types:

- `NUMBER`
- `LENGTH`
- `AREA`
- `VOLUME`
- `ANGLE`
- `OTHER`

Examples from Autodesk docs:

- `param_name##NUMBER##GENERAL`
- `param_name##NUMBER##PERCENTAGE`
- `TotalArea##AREA##INCHES` (doc wording appears sloppy here; likely means square inches conceptually, but the literal token shown should be treated as documentation, not unit truth)

## Relationship to type catalogs

This is the most relevant architectural point for FF.

### Similarities

Lookup tables and type catalogs clearly share a very similar declaration grammar:

- delimited plain-text tabular format
- headers use `ParameterName##Type##Units`
- both carry typed/unit-aware tabular data intended for family configuration

### Differences

Type catalogs:

- are external `.txt`
- define **types** loaded into a project
- are a family-loading mechanism

Lookup tables:

- are CSV-based
- feed **formula-driven parameter lookup**
- are used inside the family editor/family formulas
- may be embedded into the family via import

### Strong design inference

FF should model these as **two transports over one shared tabular type system**:

- `type catalog` = type-definition transport
- `lookup table` = formula/query transport

That lets you unify naming, validation, units, and row/column abstractions while still emitting either `.txt` type catalogs or `.csv` lookup tables.

## About your datatype hypothesis

Your hypothesis that lookup tables likely share the same datatype/unit declaration system as type catalogs looks well-founded.

Evidence:

1. Autodesk lookup-table CSV docs define the same `name##type##unit` header pattern.
2. Type-catalog docs publish a broader table of declaration examples.
3. API-level `FamilySizeTableColumn.GetSpecTypeId()` and `GetUnitTypeId()` imply Revit resolves lookup columns into typed/spec-aware metadata.

### Conservative conclusion

Use the **intersection** of officially documented lookup-table types as the guaranteed portable baseline:

- `NUMBER`
- `LENGTH`
- `AREA`
- `VOLUME`
- `ANGLE`
- `OTHER`

Then optionally allow an FF “extended” layer that can coerce richer logical types onto that baseline when emitting Revit CSV.

Examples:

- `boolean` -> `OTHER` with `0|1`
- `integer` -> probably `OTHER` or `NUMBER` depending on how you want to preserve intent
- `text` -> `OTHER`
- `familyType` -> `OTHER`
- `url` -> `OTHER`
- `currency` -> maybe unsupported for lookup-table v1 unless proven by tests
- `slope` -> maybe unsupported for lookup-table v1 unless proven by tests

## Recommended FF abstraction

Because you want best-effort validation and eventually cross-vertical reuse, I would not make raw Revit CSV headers the primary internal representation.

Instead use a normalized internal model and compile it to Revit lookup-table CSV.

## Proposed naming direction

Since you’re already migrating naming across docs/internals/tests, I’d avoid terms that are too Revit-specific at the core.

### Suggested core terms

- `table schema`
- `table column`
- `table row`
- `lookup key`
- `lookup result column`
- `table cell`
- `value spec`
- `unit token`
- `revit table codec`
- `revit lookup table codec`
- `revit type catalog codec`

### Avoid as core terms

- `size table` as the main domain term
- `family size table` except in API adapter code
- `type catalog syntax` leaking into core model

### Suggested layering

- `core/tabular/*` or `domain/tables/*`
  - portable schema/value model
- `revit/table-codecs/*`
  - encode/decode headers/rows to Revit formats
- `revit/lookup-tables/*`
  - lookup-specific formula/import/export behavior
- `revit/type-catalogs/*`
  - type-catalog-specific emission

This structure should fit your stated migration goal better than having “type catalog” own the abstractions.

## Minimal v1 feature shape for FF

### Scope

Implement a first-class lookup table definition that can:

1. define columns with logical FF types
2. define one or more key columns
3. define result columns
4. validate rows against declared types
5. emit Revit-compatible CSV headers/rows
6. generate formulas that read multiple parameters from one row via repeated `size_lookup(...)`

### Why repeated formulas

Revit lookup tables do not set multiple parameters in one atomic formula call. The practical pattern is:

- one table
- many dependent family parameters
- each parameter formula calls `size_lookup(...)` against the same key set but different return column

So your POC test should prove:

- one row match
- multiple family parameters sourced from one lookup table row
- e.g. `opening_size`, `external_static_pressure`, `cfm_label` or similar all derive from the same lookup inputs

That satisfies your “set multiple parameters at once” goal semantically, even though Revit executes it as multiple formulas over one shared lookup row.

## Proposed FF internal model

```ts
interface TableSchema {
  name: string
  transport: 'lookup' | 'typeCatalog'
  columns: TableColumn[]
  keyColumnCount?: number
}

interface TableColumn {
  name: string
  logicalType: 'number' | 'length' | 'area' | 'volume' | 'angle' | 'text' | 'bool' | 'int' | 'percent' | 'familyType'
  revitStorageType: 'NUMBER' | 'LENGTH' | 'AREA' | 'VOLUME' | 'ANGLE' | 'OTHER'
  unitToken?: string
  role?: 'rowLabel' | 'lookupKey' | 'result'
}

interface TableRow {
  label: string
  values: unknown[]
}
```

## Recommended coercion rules for v1

- `text` -> `OTHER`
- `bool` -> `OTHER` with writer coercion to `0|1`
- `int` -> `OTHER` initially, unless testing proves `NUMBER` is safer for formulas you need
- `percent` -> `NUMBER##PERCENTAGE`
- plain scalar number -> `NUMBER##GENERAL`
- measurable dimensions -> native measurable token (`LENGTH`, `AREA`, etc.) with stable emitted units

## Unit strategy recommendation

I agree with your instinct: use your **own abstraction layer** and emit to a **single stable unit scheme**.

That is the safest design.

### Recommended approach

Internally:

- represent values in FF canonical units per spec
- validate logical type + unit compatibility before emission

At emission time:

- choose one stable Revit token per measurable type for lookup tables
- convert all row values to that unit system
- serialize deterministically

### Example stable emission defaults

These are suggestions, not yet repo-specific decisions:

- length -> `FEET`
- area -> `SQUARE_FEET`
- volume -> `CUBIC_FEET`
- angle -> `DEGREES`
- number -> `GENERAL` or `PERCENTAGE`

This keeps the writer simple and predictable. If you want metric-facing authoring, keep that in FF input, not the emitted CSV contract.

## Validation strategy

### Preflight validation in FF

Validate:

- unique table name
- unique column names
- supported logical type
- legal mapping to Revit header tokens
- consistent row width
- row-label presence
- key columns contiguous immediately after first label column
- result columns not referenced as lookup keys by mistake
- value coercibility into emitted unit scheme
- duplicate key tuples

### Optional stricter validation

- no empty strings in key columns
- all rows sorted by key tuple for deterministic output
- detect columns named with characters likely to break formulas

### Revit round-trip validation

If/when you have Revit integration tests:

- emit CSV
- import with `FamilySizeTableManager.ImportSizeTable(...)`
- fail test on `false`
- surface `FamilySizeTableErrorInfo`
- optionally re-read `FamilySizeTable` / `FamilySizeTableColumn` metadata

## POC test design

A good first proof-of-concept should stay simple and prove the core architecture.

### Suggested scenario

Use an equipment-like family scenario such as `pe-grd` with keys:

- `cfm`
- `external_static_pressure`

and result columns:

- `opening_width`
- `opening_height`
- `reported_cfm_text` or `performance_label`

Then generate formulas for multiple parameters like:

- `Opening Width = size_lookup(TableName, "Opening Width", default, CFM, ESP)`
- `Opening Height = size_lookup(TableName, "Opening Height", default, CFM, ESP)`
- `Performance Label = size_lookup(TableName, "Performance Label", "", CFM, ESP)`

This proves one lookup key tuple can drive multiple dependent parameters.

### If you want hydronic direction later

Add keys like:

- entering_water_temperature
n- mode / capacity step / watts / amps

and result columns like:

- leaving_water_temperature
- gpm
- pressure_drop

But keep that out of the first POC.

## Architectural recommendation for the migration

Because you also want a language cleanup, I would aim the migration around these explicit concepts:

1. **table schema** = common model
2. **Revit codec** = file/header/units serialization
3. **lookup binding** = family parameter formulas that read from a schema
4. **catalog binding** = family type generation/export from a schema

This gives you a clean naming migration target that spans:

- docs
- internals
- tests
- filenames

without centering everything on one Revit artifact.

## What I would implement next once the repo is available

1. Locate current naming migration diff and existing family/type-catalog modules.
2. Identify current places where tabular parameter data is modeled ad hoc.
3. Introduce a shared schema/value model.
4. Add Revit lookup-table CSV writer.
5. Add header/type/unit validation with FF logical types.
6. Add formula-generation helpers for repeated `size_lookup(...)` bindings.
7. Rename old type-catalog-centric files/modules to table/schema-centric names where justified.
8. Add one POC test proving one lookup row feeds multiple parameters.

## Open questions to resolve in implementation/testing

- Does your current repo already have a units abstraction we should reuse instead of creating a new one?
- Do you want lookup tables and type catalogs to share exactly one schema type, or separate schema types over shared primitives?
- Which logical FF types should be officially supported in v1?
- Should `bool` map to `OTHER` always, or should FF expose a stronger boolean semantic type and only coerce during Revit emission?
- Do you want emitted lookup tables to target imperial stable units (`FEET`, etc.) or metric stable units?
- Do you want string-return lookup support in the first POC, or numeric-only initially with tests staged later?

## Sources

### Revit API MCP

- Revit API 2025: `FamilySizeTableManager`
- Revit API 2025: `FamilySizeTable`
- Revit API 2025: `FamilySizeTableColumn`
- Revit API 2025: `FamilySizeTableErrorInfo`

### Autodesk docs / web

- About Lookup Tables (2026): https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Customize/files/GUID-91270AEF-225A-49D7-BF84-1F44D1E3E216.htm
- CSV File Structure (Autodesk): https://help.autodesk.com/cloudhelp/2021/ENU/Revit-Customize/files/GUID-DD4D26EB-0827-4EDB-8B1F-E591B9EA8CA0.htm
- Manage Lookup Tables: https://help.autodesk.com/cloudhelp/2022/ENU/Revit-Customize/files/GUID-ABF523B6-A209-4A62-AA4E-14DAB98AA209.htm
- Create a Type Catalog: https://help.autodesk.com/cloudhelp/2024/ENU/RevitLT-Customize/files/GUID-FFA71D72-D4C5-416D-BF65-1757657C3CE9.htm
- AU presentation you linked: https://static.au-uw2-prd.autodesk.com/Class_Presentation_AS124165_The_Power_of_Revit_Lookup_Tables_Ralph_Schoch_1.pdf

## Bottom line

Best current recommendation:

- model lookup tables and type catalogs as **one shared typed tabular domain**
- keep raw Revit header syntax as a codec concern
- ship v1 with a constrained supported type set plus FF coercions (`bool`, `text`, etc.)
- use deterministic emitted units
- prove the concept with one test where several dependent parameters read from one lookup row
- do the naming migration around `table/schema/codec/binding`, not around `type catalog`
