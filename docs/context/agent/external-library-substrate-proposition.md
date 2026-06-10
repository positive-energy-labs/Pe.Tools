# Proposition: Use External Libraries as Narrow Substrates, Not Architecture Drivers

## Status

Research proposition. Temporary context for evaluating TOON, schema tooling, and analytics/cache substrates.

## Proposition

External libraries make the schema-compression/discovery concept viable, but none justify replacing Pe.Tools' typed host contracts or Revit data ladder. The safest near-term architecture is:

- keep JSON DTOs and generated host-operation metadata as source of truth;
- use TOON/TOON-like rendering only as an agent prompt projection;
- use JSON Schema tooling for validation/codegen experiments where it improves current schema/profile workflows;
- use DuckDB/Parquet only for durable discovery caches or analytics-heavy projections, not for live host-operation responses.

## Evaluation summary

| Candidate                                       | Fit                                                                  | Use it for                                                                                              | Do not use it for                                                         | Recommendation                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| In-repo `source/Toon`                           | Already local, Newtonsoft-based, simple JSON↔TOON transpiler         | Experiments, tests, prompt-rendering prototypes                                                         | Public contract authority, unsupported arbitrary edge cases without tests | Keep as experimental adapter. Harden only if Pea usage proves value.                      |
| Official TOON ecosystem                         | Strong fit for compact LLM-readable uniform arrays                   | Prompt-facing compression for host-operation maps, schedule summaries, matrix rows                      | Replacing JSON transport, deeply nested/irregular Revit DTOs              | Adopt the format posture; avoid overcommitting to one implementation early.               |
| Cysharp ToonEncoder-style approach              | High-performance .NET encode-only direction                          | Future server-side rendering if .NET version/perf constraints align                                     | Immediate adoption if it requires runtime upgrades or loses decode tests  | Track, but not a near-term dependency.                                                    |
| JsonSchema.Net / json-everything                | Mature .NET JSON Schema validation/evaluation suite                  | Schema validation, schema bundling, pointer/path-oriented diagnostics, generated artifacts              | Replacing existing DTOs or RevitData contracts                            | Evaluate for profile/schema authoring and test harnesses, not for Revit data semantics.   |
| Corvus.JsonSchema                               | Strong schema-first typed-view model over raw JSON                   | High-performance typed JSON views, schema-first discriminated unions, large JSON artifact inspection    | Simple DTO code where normal C# records are clearer                       | Consider later if schema artifacts become large enough that zero-allocation views matter. |
| NJsonSchema / Semantic Kernel structured output | Useful ecosystem for schema/type-driven structured outputs           | Model-output validation and fallback paths                                                              | Document-data authority or collector design                               | Keep as optional structured-output tooling; not central to compression.                   |
| DuckDB + Parquet                                | Strong fit for persisted, columnar, analytics-heavy discovery caches | Cross-document inventories, schedule/parameter/family analytics, offline DA artifacts, queryable caches | Live Revit bridge calls, small prompt compression                         | Defer until there is a durable cache/analytics use case.                                  |

## In-repo TOON findings

`source/Toon` is a small Newtonsoft.Json-based project with `ToonEncoder`, `ToonDecoder`, `ToonOptions`, `ToonTranspiler`, exceptions, and semantic comparison helpers.

Important details:

- `ToonTranspiler` is a thin JSON↔TOON wrapper: parse JSON to `JToken`, encode; decode TOON to `JToken`, pretty-print JSON.
- `ToonOptions` defaults to two-space indentation, comma delimiter, and strict decoding.
- The encoder prefers tabular arrays only when every item is an object with the same keys and primitive-like values.
- Primitive arrays are rendered inline.
- Mixed/non-uniform arrays fall back to list form.
- The decoder validates headers, row column counts, list markers, declared array lengths, and indentation in strict mode.
- Floats are canonicalized away from exponent notation; NaN/Infinity encode as `null`.

This is sufficient for prototypes and semantic round-trip tests. It is not yet enough to make TOON a public transport promise.

## Official TOON fit

The official TOON site describes TOON as a compact, human-readable encoding of the JSON data model for LLM prompts. It claims:

- deterministic, lossless JSON-data-model round trips;
- explicit `[N]` lengths and `{fields}` headers as guardrails;
- tabular arrays for uniform object arrays;
- indentation instead of braces and minimized quoting;
- multi-language implementations including .NET;
- benchmark claims of 76.4% accuracy vs JSON's 75.0% while using roughly 40% fewer tokens in mixed-structure tests.

This directly matches Pea's need to read compact maps of operations, schemas, schedule summaries, matrix rows, and candidate lists.

The limitation is just as important: TOON's advantage is strongest for uniform arrays. Revit DTOs often contain nested, optional, irregular records with provenance and diagnostics. Those should stay JSON or be projected into explicit uniform summary rows before TOON rendering.

## JSON Schema tooling fit

### JsonSchema.Net / json-everything

The json-everything ecosystem is broader than a validator. JsonSchema.Net evaluates schemas against JSON instances and can produce validation output with JSON Pointers/URIs and annotations. The ecosystem also includes related path, pointer, patch, OpenAPI, generation, and code-generation pieces.

Good Pe.Tools uses:

- profile/schema validation experiments;
- generated schema bundles for agent/LSP context;
- path/pointer diagnostics for schema zoom;
- test harnesses that prove generated schema artifacts and examples match.

Poor uses:

- replacing C# DTO contracts for host operations;
- encoding Revit API semantics in JSON Schema alone;
- forcing every RevitData operation through schema-first design before the operation shape is stable.

### Corvus.JsonSchema

Corvus.JsonSchema is attractive when the source of truth is JSON Schema and callers need efficient typed views over UTF-8 JSON. Its documented strengths include slim .NET value types, low/no allocation property access, no eager deserialization conversion cost, and schema composition/pattern matching support.

Good Pe.Tools uses:

- large generated artifacts where consumers inspect a few fields repeatedly;
- schema-first discriminated unions if profile shapes become harder to keep type-safe manually;
- high-performance validation/projection of durable JSON artifacts.

Poor uses:

- ordinary host-operation DTOs where C# records are clearer;
- early Revit operation design, where semantic collector behavior matters more than schema mechanics.

## DuckDB / Parquet fit

DuckDB can efficiently read/query CSV, Parquet, and JSON files directly by filename, and can create views over `read_parquet`. It can also write compressed Parquet output with `COPY`.

This is relevant for Pe.Tools if discovery becomes persistent or cross-document:

- schedule field fingerprints across many models;
- family/type/parameter inventories across projects;
- APS Design Automation collection artifacts;
- offline QA dashboards or frontend page models;
- analytics over repeated nullable/tabular Revit data.

It is not the right substrate for live Revit bridge responses. A host operation answering an active-document question should remain a bounded typed DTO. DuckDB becomes valuable after collection, when data needs to be persisted, queried, joined across documents, or converted into external artifacts.

## Architecture implications

### Do now

- Treat TOON as a renderer/post-processor.
- Add fixture-based renderer tests over real generated metadata and representative RevitData payloads.
- Keep all source-of-truth contracts in `Pe.Shared.HostContracts` and `Pe.Shared.RevitData`.
- Add compression only at generated artifact / Pea prompt / report boundaries.

### Do later if usage proves it

- Add a small shared projection model if Pea, CLI, and future UI all need the same compressed map.
- Add a schema tooling dependency where it replaces hand-maintained validation/codegen work.
- Add DuckDB/Parquet artifact generation for cross-document Revit data analytics.

### Do not do yet

- Do not return TOON from public host HTTP operations.
- Do not introduce DuckDB into live Revit collection paths.
- Do not replace hand-maintained C# host client ergonomics with schema-generated generic clients.
- Do not add a new package solely because compression feels important.

## Verification criteria

- Renderer tests prove semantic equivalence for supported TOON round trips.
- Token-count tests show meaningful wins on representative operation maps and Revit summary/matrix rows.
- Fallback tests prove irregular DTOs stay JSON/markdown rather than malformed TOON.
- Schema-tooling experiments demonstrate better validation diagnostics or less generated-code friction than current approaches before a dependency is adopted.
- DuckDB/Parquet proof waits for a concrete persisted artifact use case and measures size/query benefits against simple JSON/JSONL.

## Current recommendation

Adopt a hybrid: JSON DTOs as authority, generated compressed maps for Pea, TOON as an optional prompt renderer, schema tooling as targeted validation/codegen support, and DuckDB/Parquet only for durable analytics caches. No external library currently justifies a wholesale architecture change.

## References

- `source/Toon/Toon.csproj`
- `source/Toon/ToonEncoder.cs`
- `source/Toon/ToonDecoder.cs`
- `source/Toon/ToonOptions.cs`
- `source/Toon/ToonTranspiler.cs`
- `source/Pe.Shared.HostContracts/Operations/HostOperationsCatalog.cs`
- `source/Pe.Shared.RevitData/RevitDataProjectionContracts.cs`
- TOON: <https://toonformat.dev>
- JsonSchema.Net basics: <https://docs.json-everything.net/schema/basics>
- Corvus.JsonSchema article: <https://endjin.com/blog/composition-polymorphism-pattern-matching-with-json-schema-dotnet>
- DuckDB data overview: <https://duckdb.org/docs/current/data/overview.html>
- DuckDB Parquet overview: <https://duckdb.org/docs/current/data/parquet/overview.html>
