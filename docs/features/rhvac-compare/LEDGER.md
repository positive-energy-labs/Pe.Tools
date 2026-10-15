# RHVAC Compare ledger

## Decided

- 2026-10-13, RHVAC Compare is a portable Pod with a Page and a Revit-free companion runner. `Pe.Shared.Rhvac` owns saved-file extraction, VB6 value decoding and comparison; `Pe.Rhvac.Tool` is the thin CLI/HTTP adapter. The installed Page scripting door requires Revit and is not the execution path for file reads.
- 2026-10-13, the user confirmed a saved, explicit identity registry. Stable logical room/system keys map each source SHA-256 to a row Number; an omitted assignment is unknown, explicit null is not present, and duplicate keys/assignments fail closed. Source slots and names never silently create correspondence.
- 2026-10-13, static export freezes all loaded source bytes, snapshots, registry assignments and ordered-pair comparisons into one HTML viewer. The live companion connection is stripped. The Pod home is `Documents/Pe.Tools/Pods/rhvac-compare`; its Page is `/pages/rhvac-compare--compare/`.
- 2026-10-13, extraction uses an embedded 32-bit PowerShell/Jet adapter over an owned temporary copy. C# handles domain decoding and comparison. The reader accepts `.rh9`, `.rh10` and `.r10`; VB6 scalar type 4 is single precision, both observed scalar separators are read, and non-finite values have valid JSON tags.

## Tried & rejected

- 2026-10-13, the ad hoc Python report could not regenerate its embedded-database comparisons, and exported labels had corrupted Unicode. The retained raw extraction matched fresh reads; the replacement has one complete reader/comparison pipeline and preserves source bytes before invoking Jet.
- 2026-10-13, pairing rooms/systems by Number or assemblies by index does not establish physical identity. The Pod requires explicit room/system assignments and displays stored assembly order/length without declaring reorders engineering-neutral.
- 2026-10-13, relying only on `/pages/pe.js` `pe.fetch` did not work on installed 0.7.24 because that exported helper was absent. The launcher stamps its own validated companion receipt into the live Page; static export removes it. No installed host or document binding was changed.

## Owed

- Import the user's no-edit RHVAC 10 conversion and optional separately recalculated file; assign their records to the registry and compare conversion/save effects separately from audit inputs. Installed RHVAC is 10.1.57; the audit file records 10.1.17.
- Before route promotion, choose the host-owned file-operation adapter and Page principal/state integration. The Pod's local companion is the current adapter; no first-party route or installed MSI payload was added.
