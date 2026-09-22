# factory ledger

The factory is the control loop over this repo: sensors read the tree at a commit, loops compare readings to setpoints, actuators propose branches, kaitpw gates them, and the next commit measures the delta. Design record: [factory.html](factory.html). Lines dated 2026-09-18 supersede any 2026-09-17 line they contradict (SQLite log, `factory.toml`, `dev` and distill, setpoints, `POST /verdict`).

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
- 2026-09-17, the factory is not the code it mutates: sensor and prompt commands resolve `{root}` to the tree the daemon loaded `factory.toml` from, and only the plant is a clean checkout of the measured sha. Found when round 1's first proof failed with `MODULE_NOT_FOUND` inside the checkout.
- 2026-09-17, the daemon merges only into a ref checked out in its own tree; a production daemon runs from its own clone, never from kaitpw's checkout. Found while writing the round 2 brief: `main` is checked out in the user's tree, so no worktree can move it.
- 2026-09-17, a failed sensor reading is `null` in the error term, never `0`; the reviewer proved round 1 painted a failed sha as satisfied.
- 2026-09-17, proposal branches live at `factory/<loop>/<sha7>`, so no branch may be named `factory`; git cannot hold a ref and its child namespace. The build worktree branch is `factory-dev`.
- 2026-09-17, actuator worktrees are never installed; a workspace tool runs from the daemon tree's `node_modules` JS entry (`node {root}/source/pe-tools/node_modules/.pnpm/node_modules/oxfmt/dist/cli.js`). Proven live: `format` reached `actuator changed nothing` instead of `Package not found in workspace`.
- 2026-09-17, a tick takes an exclusive lock file (`.artifacts/factory/tick.lock`), because the daemon and a `--once` share one log; an in-process flag protected nothing.
- 2026-09-17, a run worktree must prove its own git top-level before any reset, add, or commit; a bare leftover directory resolves to the daemon's tree and would move `ref`.
- 2026-09-17, a proposal's diff opens in the IDE (`code <worktree>`), not rendered in the page; raw diff text stays reachable at `GET /runs/<run>/diff` for agents and curl. kaitpw: "ide is prob fine and more occam".
- 2026-09-17, model actuators wait until the verdict is no longer blind: a proposal shows its motivating error vector, actuator output, and an open-in-IDE action first.
- 2026-09-18, the factory writes nothing that cannot be recomputed except proposals and verdicts, and both live on origin. Readings, findings, and run output are a local cache on the daemon box (`.artifacts/factory/cache.jsonl`); a second machine reads them over HTTP. Sharing has two channels, origin and HTTP, and no third.
- 2026-09-18, HTTP exposure over the tailnet is required. kaitpw: "tailnet exposure, or at least some type of http exposure, is necessary". The daemon is one process that ticks and serves a read-only page.
- 2026-09-18, the gate is a GitHub pull request. The daemon pushes `factory/<loop>/<sha7>` and runs `gh pr create --label factory`; accept is the squash button, reject is close with a comment, and the next run of that loop reads the comment. kaitpw: "i hate it but theres nothing better". The page links to open PRs and holds no verdict verbs.
- 2026-09-18, the declaration is `factory.config.ts`, an array of typed loop objects; `when` is a function over a finding's evidence. kaitpw: "i like the typing and just opens more future doors". This retires `factory.toml`, `smol-toml`, `{root}` templating, and any predicate string.
- 2026-09-18, a sensor is `(sha) => Finding[]`; a finding is `{mechanism, path, evidence}` and carries no score, because judgment stays out of the sensor. Chart numbers are aggregates of findings.
- 2026-09-18, a loop acts only above its bar. Findings under the bar cost no tokens and are not filed anywhere; the next tick recomputes them and the page lists them. kaitpw: "spining off a fix for everything that surpasses some (somewhat subjective) theshold of signal".
- 2026-09-18, no setpoint arithmetic. The sensor verdicts ([research](../../research/2026-09-17-sensor-poc-verdicts.md)) killed count gates as Goodhart bait; counts are gauges.
- 2026-09-18, LOC by directory and by file at HEAD is the page's first view, ahead of the time series. kaitpw: "I personally find LOC breakdowns, especially per file and dir, really helpful to understanding structure".
- 2026-09-18, churn is a trigger kind: `on: { churn: 500 }` fires when lines changed since the loop's last run reach the threshold. A budget caps the heavy day. kaitpw: "some days i dont code at all, some days I my agents make 300 commits".
- 2026-09-18, one ref, `origin/main`; every branch squash-merges to it with a written message. kaitpw: "my merges are rarely clean in terms of conflicts and more generally responsibility. this is what makes my git so hard to read." Packages touched per merge is a reading.
- 2026-09-18, the score source is deterministic evidence. A model `triage` actuator is added only when the bar files too much or spends too much.
- 2026-09-18, kaitpw's side of the loop: work and squash to `main`; squash or close factory PRs from either machine or a phone; read the page as a gauge; edit `factory.config.ts` when a loop is too eager or too quiet.
- 2026-09-18, the first model loop is `/purge` on the top file by churn, `on: { churn: 500 }`, budget one run per day, gate `pr`.

## Tried & rejected
- 2026-09-17, Mastra as the factory substrate; its agent layer is API-key shaped (forbidden: Claude Max is subprocess-only), loops would become code instead of tables, and Studio shows Mastra's nouns. Suspend/resume survives as `state = gated` on a row.
- 2026-09-17, Temporal as the first controller; it adds a second state owner and a determinism contract on the code iterated most, to buy durable timers a log does not need. It is the named upgrade if a run ever needs a live process to wait.
- 2026-09-17, file-backed inbox with `ls` as the UI (the option map's floor); no log, so no projection, fails "UI from day one".
- 2026-09-17, distill shape D2 (grouped squashes, `dev` reset after each distill); every in-flight worktree rebases each time. Re-open only if first-parent history proves unreviewable.

- 2026-09-18, SQLite, git notes, and an orphan `factory-log` branch as the store; all three solved sharing for data that is re-derivable. Notes do not fetch by default; the orphan branch was a mechanism kaitpw could not see the reason for.
- 2026-09-18, own verdict buttons and `POST /verdict`; open-in-IDE runs on the daemon box and breaks from the laptop, and proposals must reach origin anyway. Pull requests give the buttons for free.
- 2026-09-18, owed as a repo-wide log (`owed.jsonl`); machine findings re-derive, and human owed lines are already dated bullets whose log is `git log -p`.
- 2026-09-18, `dev` plus distill, and a squashed release branch; squash-merge to `main` solves history legibility with one ref.

## Owed
- Rewrite the package on the 2026-09-18 shape, target about 300 lines: fetch, sense, cache, act above the bar, push, `gh pr create`, serve. kaitpw: "rewrite". Proof lane: deterministic test against a bare-repo origin with `gh` stubbed, then one live PR on the `format` loop with kaitpw watching.
- Mining loop: scheduled `/ground` over closed `factory` PRs, ledger owed lines, and the under-bar list; deferred until the purge loop has run two weeks.
- Adopt the sensor verdicts' winners as sensors: analyzer counts, the oxlint react rule, repo-guards, the portable boundary; each names its failure mechanism.
- Set `branch.main.mergeoptions --squash` on both machines when the rewrite lands.
- Merge `factory-dev` (worktree `../Pe.Tools-factory`) after round 2's review; reports under `.artifacts/runs/factory-20260917/`.
- Round 3 landed on `factory-dev` (10 commits) after a REJECT and a fix pass; kaitpw's browser proof: 12 backfilled commits plot, 67 events in the feed, proposals show motivation and open-in-IDE. Reports under `.artifacts/runs/factory-20260917/r3/`.
- The control chart's y axis does not scale to the data range, so a 450-line move over 12 commits draws flat; scale y to the series' min and max with the setpoint line inside.
- Purge pass on `src/main.ts` (about 1000 lines, one `ponytail:` marker) before a model actuator lands on it.
- A page claim is proven only by a screenshot or a DOM assertion; the charts were dead from round 1 to round 3 because every report described them and nobody looked. The test now asserts the chart projection; keep that rule for every new region.
- Round 4: real actuator via `run-agent.ps1` (codex draft, claude review), env scrub proven on the subscription dashboards, `budget` enforced.
- At merge: rule on `docs/features/factory/ECHO.md` (proof residue) and the `echo` loop in `factory.toml` (an always-acting stand-in useful for exercising the gate; not a real loop).
- The production daemon needs its own clone of the repo with `dev` checked out; until then the factory can only observe `main` from a worktree and act on `factory-dev`.
- mise is not installed; sensor and actuator rows run raw commands until mise is adopted for tool pins and `sources` staleness.
- The projection page is vanilla HTML in round 1; taking the kit as a workspace dependency is owed once the kit is a package.
- Unverified: whether mise merges nested package `mise.toml` tasks upward without an includes entry.
