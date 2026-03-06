# Toon Transpiler

Standalone JSON<->TOON transpiler with verification focused on Family Foundry-style config data.

## Public API

- `ToonTranspiler.EncodeJson(string json, ToonOptions? opts = null)`
- `ToonTranspiler.DecodeToJson(string toon, ToonOptions? opts = null)`
- `JsonSemanticComparer.AreEquivalent(string leftJson, string rightJson)`

`ToonOptions` currently supports:

- `IndentSize` (default `2`)
- `Delimiter` (default `,`, supports `,`, `\t`, `|`)
- `StrictDecoding` (default `true`)

## Supported subset (guaranteed)

- Root object, root array, and root primitive documents.
- Nested objects via indentation.
- Arrays:
  - Inline primitive arrays: `items[3]: a,b,c`
  - List arrays with `-` markers.
  - Tabular arrays for arrays of uniform single-layer primitive-valued objects:
    - `items[2]{type,value}:`
      - `W5BM024,208V`
      - `W5BM036,208V`
- Primitive values:
  - string (quoted and unquoted)
  - integer and floating-point numbers
  - `true`, `false`, `null`
- Escapes in quoted strings:
  - `\\`, `\"`, `\n`, `\r`, `\t`

## Verification methodology

Verification is implemented in `source/Pe.Tools.Tests` using a Revit-backed TUnit host (`Nice3point.TUnit.Revit`) with:

- Deterministic unit tests for parser/encoder behavior.
- Strict-mode failure tests (indentation/count mismatch).
- Corpus tests using real profile files:
  - `C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Migrator\settings\profiles\MechEquip\MechEquip.json`
  - `C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Manager\settings\profiles\TEST-WaterFurnace-500R11-AirHandler-OldParams.json`
- Differential tests against TOON CLI via command probing:
  - `toon`
  - `pnpm dlx @toon-format/cli`
  - `npx -y @toon-format/cli`

Roundtrip invariants:

- `json ~= decode(encode(json))` (semantic equality, not textual equality)
- Differential compatibility checks against TOON CLI in both directions.

## Operational limits (phase 1)

- Full TOON spec parity is not the goal in this phase.
- Canonical string quoting/formatting may differ from CLI byte output; semantic equivalence is the contract.
- Strict decoding enforces:
  - indentation multiples of `IndentSize`
  - array length header consistency
- Lenient mode (`StrictDecoding=false`) relaxes these checks.

## Deferred integration notes

This phase intentionally does **not** alter generic storage manager behavior.

Deferred follow-up for `CmdFFManager`:

- Use existing JSON fragment/include workflow as the primary integration seam.
- Resolve TOON-authored fragment content to JSON before normal `ComposableJson<T>` loading.
- Keep behind an explicit feature toggle.
- Do not introduce global filename-based auto-resolution until this path is stable.

