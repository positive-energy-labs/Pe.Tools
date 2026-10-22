# Preserve named coordinates and missing ASHRAE samples

## Context

`ducts.tables` is evidence for Pea, desktop pricing and the web. Its two-axis `AshraeGrid` cannot represent the three independent coordinates in Revit's ED5-1, ER5-1 and SR5-1 tables. ER5-1 also omits a coordinate pair. ED5-1 contains adjacent fixed-width negative values. Discarding a coordinate or filling a missing sample would change published data.

Keeping these tables unsupported is safe but leaves the evidence door incomplete. Dense tensors need a validity mask for samples that do not exist. Arbitrary-dimensional scattered interpolation adds methods the source does not establish. Source-linked failures and four prototype consumers are retained in the [diagnosis](../../.artifacts/runs/installed-20261014-pdrop/tee-table36-diagnosis/report.json).

## Decision

Use one typed grid with a named primary axis, named row-coordinate axes and sparse rows. A constant has no axis and one constant row. Support the current zero through three dimensions; remove the positional X/Y/Grid union and compatibility adapters. C# DTOs and generated operation contracts remain authoritative.

Read every published sample without dropping signs or coordinates. Require unique coordinates, complete row widths and finite values. Lookup requires the exact coordinate-name set. Exact axis values reduce the required corners; interpolation requires every positive-weight corner of the bracketing cell. Missing cells, unknown coordinates and out-of-domain queries remain explicit unknowns. No padding, extrapolation or endpoint clamping. Family CSV diameter floor/hold is a separate recipe and retains its behavior.

The changed table and lookup evidence emits `ducts-analysis-v6`. Its reader rejects older or mismatched formats explicitly. Preserve original artifacts as raw evidence; do not normalize them or migrate/reset canonical Work to fit the new wire shape.

## Consequences

All table, lookup, artifact and generated-contract consumers move together. Existing web consumers receive a mechanical data adaptation; new UI design remains separate. Preserve primary table fixtures and cross-language exact-sample, sparse-cell and boundary checks.

Reading a coefficient does not adopt an engineering law. Published negative coefficients remain data. Existing junction heuristics do not become universal converging/mixing pricing, and passive hydraulic admission still requires qualified ports, directed flows, pressure planes and energy checks.
