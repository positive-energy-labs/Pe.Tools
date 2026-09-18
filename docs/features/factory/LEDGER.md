# factory ledger

The factory is the control loop over this repo: sensors read the tree at a commit, loops compare readings to setpoints, actuators propose branches, kaitpw gates them, and the next commit measures the delta. Design record: `.artifacts/factory-shape.html` (round 2, 2026-09-17), option space: `.artifacts/factory-map.html`.

## Decided
- 2026-09-17, shape S1: one declaration (`factory.toml`), one stateless interpreter, one SQLite event log, one projection page. An append-only log makes durable execution unnecessary; a proposal at the gate is a row, not a suspended process.
- 2026-09-17, no model in the interpreter. Models run only inside actuators (`claude -p`, `codex exec` as subprocesses) and never in routing, scheduling, or threshold arithmetic.
- 2026-09-17, a sensor is a pure function of `(sensor, sha)`; readings are idempotent and re-derivable, so only verdicts are irreplaceable.
- 2026-09-17, two event kinds for measurement: `reading` is surveyed by deterministic code and may carry an error; `report` is model-authored, drawn dashed in the UI, and never enters an error term.
- 2026-09-17, meaning at the root, measurement at the leaf: `factory.toml` at repo root is the only catalog of sensors and loops; sensor code lives beside what it measures. No `/sensors` directory convention; a sensor not in the declaration does not exist.
- 2026-09-17, the factory is a workspace package (`source/pe-tools/packages/factory`), not its own repo, extracted only on a second consumer. It ships its own projection page served by the daemon; `apps/web` never depends on the factory schema.
- 2026-09-17, two boundaries: `dev` observes (every commit measured, nothing blocks), `main` enforces (a baseline that would rise refuses the merge). Distill is a loop whose plant is history.
- 2026-09-17, distill shape D1: merge `dev` into `main` with `--no-ff` and a written summary plus ledger lines; never rewrite. Reviewable history is `git log --first-parent main`.
- 2026-09-17, a review is an actuator, not a sensor; its plant is the ledgers and its proposal is Owed lines. Structure, concept, and tests are three loop rows, and the interpreter does not know the word "review".
- 2026-09-17, the first loop is format-on-merge with `gate = auto`, because it proves the whole path with zero tokens.

## Tried & rejected
- 2026-09-17, Mastra as the factory substrate; its agent layer is API-key shaped (forbidden: Claude Max is subprocess-only), loops would become code instead of tables, and Studio shows Mastra's nouns. Suspend/resume survives as `state = gated` on a row.
- 2026-09-17, Temporal as the first controller; it adds a second state owner and a determinism contract on the code iterated most, to buy durable timers a log does not need. It is the named upgrade if a run ever needs a live process to wait.
- 2026-09-17, file-backed inbox with `ls` as the UI (the option map's floor); no log, so no projection, fails "UI from day one".
- 2026-09-17, distill shape D2 (grouped squashes, `dev` reset after each distill); every in-flight worktree rebases each time. Re-open only if first-parent history proves unreviewable.

## Owed
- Round 1 build: sense, log, serve, trigger, chart. Worktree `../Pe.Tools-factory`, branch `factory`, reports under `.artifacts/runs/factory-20260917/`.
- Round 2 build: actuator in a worktree, `gate = auto`, `POST /verdict`, reject-with-text re-run.
- mise is not installed; sensor and actuator rows run raw commands until mise is adopted for tool pins and `sources` staleness.
- The projection page is vanilla HTML in round 1; taking the kit as a workspace dependency is owed once the kit is a package.
- Promote `.artifacts/factory-shape.html` beside this ledger when the first round lands, and delete the `.artifacts` copy in the same commit.
- Unverified: whether mise merges nested package `mise.toml` tasks upward without an includes entry.
