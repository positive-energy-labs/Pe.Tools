# P9W native merge web results

## Changed

- Parsed `META\tsource\t<value>` with detector as the backward-compatible default and fail-fast handling for unknown values.
- Added a pure shared merge that replaces detector rooms by native Space number, retains detector-only rooms and detector residues, and appends native-only room ids.
- Routed both host-loaded and fixture-loaded TSVs through the shared merge.
- Prevented saved detector resolutions from mutating authoritative native rooms.
- Added authoritative native styling, the `native — edited in Revit` legend, and a Theatre native TSV fixture with three replacements plus one native-only room.
- Added unit coverage for every required merge rule and native-resolution precedence.

## Binding gates

- `source/pe-tools/apps/web`: `pnpm exec vp test` — 16 test files passed; 93 tests passed.
- `source/pe-tools/apps/host`: `pnpm exec vp test` — 8 test files passed; 46 tests passed.
- Product changes are confined to `source/pe-tools/apps/web`; this file is the mission-required results artifact.
- Changes staged; no commit created.

## Additional checks

- Targeted `takeoff.test.ts`: 22 tests passed.
- Scoped Vite+ format/lint/type check: clean for all touched web files.
- Full web TypeScript check: clean.
