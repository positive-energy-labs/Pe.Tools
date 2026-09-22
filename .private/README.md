# .private

Machine-local data that must never be committed, bundled, or served from a release build. Everything here except this file is gitignored. Delete this folder and every test that reads it skips; nothing fails.

Tests and scripts resolve the root from `PE_PRIVATE_FIXTURES`, defaulting to `<repo>/.private/fixtures`. C# tests call `PrivateFixtures.Dir("<relative>")` (`eng/PrivateFixtures.cs`); TypeScript tests `skipIf` on `existsSync`; python and PowerShell scripts take a `--project` or `-SourceR10` default under the same root. The web dev server serves `fixtures/project-a/web/` at `/rhvac-fixture` in dev only (`apps/web/vite.config.ts`); the production bundle never contains it.

## Layout

| Path | What | Canonical copy |
|---|---|---|
| `fixtures/project-a/rhvac/` | RHVAC takeoff eval set: `oracle.extract.json`, `takeoff/rooms_*.tsv`, `bluebeam/*.markups.json`, `room-map.json`, `tolerances.json`, `conventions.json`, `local.r10` | kaitpw, firm G: drive |
| `fixtures/project-a/partition/live`, `main-09` | Partition solver captures: input, probes, answer | recaptured by `eval/rhvac/partition-run.py` |
| `fixtures/project-a/web/` | Browser takeoff demo: `manifest.json`, extract, room map, TSVs, `zones.json` (45 declared zones) | derived from `rhvac/` |
| `fixtures/project-b/rhvac/` | second RHVAC eval set, two levels | kaitpw |
| `fixtures/project-c/partition/live`, `level2` | Partition captures | recaptured |
| `rewrite/` | inputs for the 2026-09 history rewrite | disposable after the rewrite |
| `sdk-feed/` | optional home for the local NuGet feed if it leaves `eng/sdk-feed` | NuGet |

Project tokens are deliberate. Never put a client name in a path or a file under `source/`, `eval/`, or `docs/`.
