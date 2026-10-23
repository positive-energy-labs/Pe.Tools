# e2e lane: one test per acceptance journey (E2E-J1..J6)

## Seeded route journey (Vitest + chrome-agent)

From an integrated checkout, the owned demo is one command:

```powershell
vp run --no-cache journey:routes
```

The launcher starts `src/dev.ts --no-revit` through the checkout's installed Node/jiti runtime,
an isolated product home and local SDK/app-data roots, the canonical source Vite child, and a
private visible chrome-agent instance on a dynamically selected port. It reads the host service
receipt and returned browser identity, then runs Vitest with `refresh,worker` required. It never
starts Revit or sends a Pea prompt. The integrated navigation fixture must expose its real demo
Refresh action. `--seed`, `--require` and `--source` override the default seed, requested coverage
and served source checkout. `custody.json` and `host.log` live under the dated route-launch run.
The launcher restores online networking through the test, stops only its own Chrome, requests
token-authenticated shutdown of its own host, disconnects its IPC child and bounds process exit.
It restores the previous dev-tray receipt only while that receipt still names its own host.

Explicit attached mode borrows the named page/server and leaves their lifecycle to the caller:

```powershell
vp run --no-cache journey:routes -- --attached --url 'http://127.0.0.1:5173/ducts?demo=navigation' --port 9255 --target 129DC0038D97FA0AEC5ED4E23D8524D3 --require refresh,worker
```

`vp run --no-cache test:route-chaos` from `ts` runs the opt-in `route-chaos.config.ts` suite.
Always pass `--no-cache`: a cached task verdict cannot prove a browser journey.
It borrows one explicitly named page from a Chrome instance launched by `chrome-agent`.
It starts no browser, server, host, Revit session, or inference turn. Stop only the instance and
server you launched after the run. Keep the tab visible and serve a stable tree: editing the
served checkout invalidates a run.

```powershell
# Runtime owner: start this checkout's server separately using the repo's vp tooling.
# Choose a free private port. 9255 belongs to the parent integration session.
chrome-agent launch --port 9264 -- --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
$env:CDP_PORT = '9264'
# /json is CDP metadata, never an application-state oracle. Pick the full id of your own page.
$pages = Invoke-RestMethod "http://127.0.0.1:$env:CDP_PORT/json"
$pages | Select-Object id, type, url
$env:CDP_TARGET = '<full page id>'
$env:CHAOS_LANE = 'demo'
$env:E2E_WEB = 'http://127.0.0.1:<actual web port>/ducts?demo=navigation'
$env:CHAOS_SEED = '20261023'
$env:CHAOS_REQUIRE = 'refresh'
vp run --no-cache test:route-chaos
# chrome-agent stop <exact instance name returned by launch>
```

The same test supports `CHAOS_LANE=host` with a full `/ducts?target=...` URL and no `demo`
query. The runtime owner supplies the host, document and disposable Work. Neither a saved
snapshot nor borrowed reads proves native writes. Do not use a person's existing draft or Work.

The seed selects rendered system controls, disruption order and outage duration. The story
searches and filters, travels all → A → B → all, uses Back/Forward, selects a tree row, opens a
copied URL and reloads it, refreshes, goes offline/online, pauses an available pricing worker,
and leaves/returns through Pea and its existing thread controls. It never sends a Pea prompt.
An empty Pea draft is required. Two visible existing threads enable A → B → A draft/transcript
identity checks. Hidden retained composers are excluded from all reads.

`CHAOS_REQUIRE` is an explicit comma-separated list of capabilities that must execute: `refresh`,
`reconnect`, `worker`, `thread`, `arming`. It has no default. Unavailable optional
capabilities get an `unavailable` step and an explicit `UNPROVEN` coverage entry. A requested
capability or missing core precondition fails Vitest; there are no skipped tests. `reconnect`
requires a new observed SSE response after the outage. Offline/online alone cannot satisfy it.
The receipt is `partial` whenever any capability is omitted or unavailable, even if the selected
Vitest assertions pass. It is `passed` only when every capability is explicitly required and runs.
The core navigation, search/filter, history, copied-URL, reload, Escape and quiet watchdog dwell
assertions always run. `CHAOS_REQUIRE=navigation` is an explicitly partial diagnostic subset.
Omitted disruptions are recorded and do not execute, so an unrelated omitted native scenario
cannot mutate Work. The quiet dwell requires an accepted lease revision from the observed host
response for the current URL thread and a world SSE subscription in the network URL. It holds
still for 36 seconds, crossing the original watchdog interval, under the same sampled continuity
checks. Missing lease or world subscription is a failed precondition, not quiet proof.
Escape must clear selection while preserving the pose. History uses the real app Back/Forward
controls where present, otherwise CDP `Page.navigateToHistoryEntry`; Alt+Arrows belongs to stage
view history and is not used as browser history.

For `arming`, supply `CHAOS_LANE=host`, `CHAOS_STAGE_SELECTOR` (a visible, enabled input on
disposable Work), and `CHAOS_STAGE_VALUE`. This step persists a Work edit through trusted input,
runs native Preview through its real control, and checks that refresh/route return disarms
the actual `write N to Revit` control. It never presses Write. Native write consumption and stale native responses still need
the parent's controlled native receipt loop. Example strict host coverage:

```powershell
$env:CHAOS_LANE = 'host'
$env:E2E_WEB = '<actual full /ducts URL with a bound disposable target>'
$env:CHAOS_REQUIRE = 'refresh,reconnect,worker,thread,arming'
$env:CHAOS_STAGE_SELECTOR = '<real visible editor selector discovered on that model>'
$env:CHAOS_STAGE_VALUE = '<valid changed value>'
vp run --no-cache test:route-chaos
```

Each run writes `.artifacts/runs/browser-YYYYMMDD-route-chaos/<seed>-<timestamp>/receipt.json`
with checkout/commit, each step's before/after DOM observations, coverage and network metadata.
A failure writes `seed-<seed>-step-<step>-failed.{html,txt,png}`. A pre-connection failure has only
the JSON receipt. The persistent CDP socket has connection/command timeouts and rejects pending
commands on disconnect. Teardown restores online networking, resumes/detaches a paused worker,
and closes the socket; it does not close the borrowed Chrome.

Continuity checks sample every 100 ms. They hold actual main, canvas/SVG, activeElement and
scroll-ancestor DOM references and check identity/connection as well as scroll positions,
pane scroll, URL pose and action arming during untouched disruptions. This is sampled continuity,
not every-frame proof. Native CDP layout-shift events cover the full disruption window. Named navigation,
selection, reload and deliberate focus moves have their own assertions. This is browser
acceptance only after the full requested lane runs; formatting and the missing-precondition
diagnostic are not acceptance. The parent supplies the deterministic `demo=navigation` fixture
with named systems through production geometry/pricing; it needs no existing Revit. The suite
also accepts `demo=scene` if it has at least two rendered systems and a selectable run. Baseline
`2ef96e25` has no systems or groups in `demo=scene`, and this test change preserves that story.

Rules (rulings-1640 §1): act only through real controls with trusted input, assert only on the rendered DOM, see each test RED first, and run against a real host (and real Revit where the journey touches it). `cdp.ts` is the whole helper; `host.ps1` starts this checkout's own no-Revit host.

## Before any Pea step (user note, 2026-09-18)

- **Preconditions:** the Chat Model chip names an OpenAI model and the Access chip reads `Trusted`. `requirePea()` reads both chips and fails as `BLOCKED` if either is wrong. Fix the setting; it is not a product defect. A new thread starts on Pea's default model, so J1, J2 and J5 first run `setPea()`: setup (lead-approved), not an assertion. It picks `E2E_MODEL` (default `gpt-5.6-terra`) and `Trusted` through the real pickers with trusted clicks, and `requirePea()` then reads both chips back from the DOM.
- **Sending:** a send is refused while a turn runs, by design. `sendChat()` waits for the turn to settle, else cancels through the real `cancel` control, then sends and waits for the turn to settle. Only J5 sends over a parked ask on purpose.
- **Cost:** each Pea turn spends the user's OpenAI credit. Run a journey once, when it is ready. Never loop a Pea turn to debug a selector; debug selectors on a non-Pea route.
- **Failures:** a turn that fails for credit or model reasons reports `BLOCKED: <exact status message>`, not a product failure.

Run: `chrome-agent launch --headless --port 924x` (your own instance), then `CDP_PORT=924x E2E_WEB=… E2E_LABEL=green node tests/e2e/j<N>.ts` from `ts`. **Ports:** hold operators own 9222, 9223 and 9231; workers pick a free 924x and never launch or drive those three. `CDP_PORT` has no default; unset, the lane stops with `PRECONDITION: CDP_PORT`. Revit journeys also take `E2E_TARGET`, `E2E_ROWS`, `E2E_PARAM` and `E2E_VALUE`. `E2E_DOC` (the document's title as the Situation ladder lists it, optional `E2E_SESSION`) binds the target through the ladder when a new thread shows `no document selected`; unset there, the journey stops as `PRECONDITION`. A matrix gets 150 s to draw its rows (project-a took ~69 s).

A missing precondition (no Revit bridge, no seed, wrong chips) ends as `RESULT: BLOCKED — …`, never `FAIL`.

## Revit data per journey

- **Verbs** are located by their word plus any count badge (`PLAN` matches `plan`, `plan 1`, `re-plan`) inside the Situation, never by exact text.
- **Draft execution (J3, J4):** staged cells plan and apply without selecting a pod. Plan files nothing. A saved-member scenario may still choose a pod because that scenario manages the member itself.
- **`E2E_ROWS`:** pick types that carry `E2E_PARAM`. A blank cell means the type lacks the parameter and renders no editor; `setCell`/`clickCell` then stop as `PRECONDITION: <row> has no <param>` (J3 on 666a58e lost a run to Balancing Damper this way).
- **J3 `E2E_ROWS`:** two rows whose apply is natively clean for a plain text write. Not Mechanical Damper (F-J3-2: its connector reconciliation fails a plain text write), and `E2E_PARAM` is not a Yes/No parameter. The stale-refusal check reads the proposals band row: the Revit value struck, then `→ {edited}`.
- **J4:** one row whose `E2E_PARAM` is a non-empty text parameter. The band row must say `by you`; no visible grid or band control may say delete/remove.

## Seeding J6 (old-shape Work)

J6 needs one unreadable `/families` Work document for `E2E_TARGET`; every `start fresh` consumes it. journeys' live J6 (2026-09-18) consumed project-a' real row, so it must be seeded again before each J6 run. Without it, J6 stops as `PRECONDITION: no old-shape Work seeded`.

Recipe (exec-proof, host stopped, a copy of the store taken first): in the host's thread-state store (`%LOCALAPPDATA%/Positive Energy/Pe.Tools/state/mastra.db` for the installed host; the dev host's own state dir otherwise), copy the value of `families:aside:<n>:families/target:<address>` (the old document `start fresh` set aside byte-for-byte; the 2026-09-18 one has value sha256 `c07521136e225240…`) to `families:families/target:<address>` under the same `threadId`, replacing the fresh Work. Record both value shas in RUN.md. Never seed the user's only copy: the aside row stays.
