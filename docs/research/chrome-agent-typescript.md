# chrome-agent TypeScript assessment

Assessed 2026-10-23; implementation followed on 2026-10-24. This document retains the source census and Windows history findings. The implemented API and CLI are documented in [@pe/browser](../../ts/packages/browser/README.md); current decisions and proof limits live in the [browser ledger](../features/browser/LEDGER.md). The installed Python tool was not changed.

## Recommendation

Build a TypeScript browser library around the useful chrome-agent behavior, with a thin CLI over the same capabilities. Serve both Pe.Tools Vitest journeys and agents working across shell calls. Full Python feature parity is unnecessary for the immediate testing goal.

The source is small enough to own. Lifecycle behavior is the expensive part: process identity, profile isolation, concurrent launches, target selection, cancellation, and cleanup. Translating Python syntax would preserve its Windows defects.

## Scope discussion after assessment

User rulings on 2026-10-23: concurrency is required from the first adoptable version; use Effect for hard lifecycle/concurrency behavior; establish useful feature equivalence before architectural convergence. A persistent automation profile was accepted initially. A subsequent ruling elevates consented attachment to the existing signed-in Chrome into the first adoption scope. Owned headless and visible browsers remain required. Helium is a later consumer. On 2026-10-24 the user authorized implementation with “great build it all the way through, dont stop til done.” Current decisions and remaining proof live in the [browser ledger](../features/browser/LEDGER.md).

Three research reports ground this scope: [actual usage sample](../../.artifacts/runs/deterministic-20261023-chrome-scope/usage.md), [profile and authentication facts](../../.artifacts/runs/deterministic-20261023-chrome-scope/profiles.md), and [architecture round 2](../../.artifacts/runs/deterministic-20261023-chrome-scope/architecture-r2.md). The completed [two-month provider/browser-mode mine](../../.artifacts/runs/deterministic-20261023-browser-provider-mine/report.md) adds 30 selected canonical call/result pairs. The parent independently reread all 30 and confirmed their source hashes and call/result ids in [parent-verification.json](../../.artifacts/runs/deterministic-20261023-browser-provider-mine/parent-verification.json). Source research has not proved future library behavior.

The inspected two-month evidence does not establish a Claude-versus-Codex browser capability gap. Both providers called T3 preview and terminal automation. Explicit headless launches explain some invisible work; reused debugger connections explain calls without fresh launch setup, but do not establish window visibility. No selected story proves access to the user's daily signed-in profile. Windows failures occurred at distinct layers: output encoding, Python dependencies, shell paths/quoting, registry replacement, and unresolved preview/application conditions. The 20,487 candidate decisions retain projection overlap; they are not unique operations or a denominator for failure rates. One native file drifted during extraction. See the report for exact scope and exclusions.

Add observability to the proposed adoption stop: each session and operation receipt identifies headless/visible/attached mode, owned/attached custody, browser version and executable when known, profile identity when known, and target id. Unknown identity stays explicit. Visible mode supports bringing the explicitly claimed tab forward on request. Headless mode provides inspectable screenshot/evidence paths rather than pretending to display a window. This makes which browser an agent used independently inspectable.

Recommended initial features: normal navigation and DOM/accessibility reads; trusted mouse, keyboard, form, scroll, hover and drag interactions; frames, popups and dialogs; file upload/download; screenshots and console/network observations; typed CDP access; machine-readable CLI results and durable operation receipts. The usage sample directly supports navigation, evaluation, screenshots and mouse input. The remaining ordinary-browser capabilities are user-intent requirements, not inferred frequency claims.

The current launcher creates new profiles and disables password saving ([launcher.py](../../.explore/chrome-agent/src/chrome_agent/launcher.py)). Retained mode must preserve native password-manager behavior. Modern Chrome separately documents user-enabled attachment to the existing signed-in browser through [its consent flow](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect). This does not imply copied profile secrets are portable or that Google will accept automated sign-in. The user completes authentication and connection consent.

User clarification on 2026-10-23: full chrome-agent-like, dynamic CDP access is central. The CLI is a first-class agent surface. A large MCP tool catalog and a restricted set of browser actions are not the desired interface. Playwright core had been proposed only as an internal connection/session mechanism; its MCP and test runner were never required. Revised recommendation: use direct CDP as the foundation. Retain Playwright only as a research candidate if a specific mechanism later needs comparison; it is not a prerequisite for the port.

The CLI accepts arbitrary `Domain.method` plus structured parameters, streams selected protocol events, and progressively discovers help from the connected browser's live protocol. Bundled TypeScript bindings improve the library's known-command types; they must not gate access to newer commands supported by Chrome. Keep an explicit raw library call for methods absent from the bundled types, returning `unknown`. This follows the clone's [one-shot forwarding](../../.explore/chrome-agent/src/chrome_agent/cli.py) and [live protocol discovery](../../.explore/chrome-agent/src/chrome_agent/protocol.py). Typed user-interaction helpers may compose this primitive without replacing it with a closed action vocabulary.

Implemented shape: one direct-CDP library with scoped Effect acquisition and Promise callers, plus one keeper process per durable CLI session. Multiple clients share that connection through exclusive page leases. Independent targets proceed concurrently. The package uses the workspace's Effect version rather than copying swell's different version.

Windows hard-kill testing required a native Job Object and guardian, followed by a joined process-exit barrier before profile-lock release. Pipe EOF alone was not accepted as proof. Attached cleanup uses the original approved connection and closes only recorded created tabs. Typed ownership does not constrain privileged raw CDP. Permitted actions can change cookies and site state, so profile-byte equality is not an acceptance invariant. Existing tabs and foreign process lifecycle remain outside cleanup ownership.

The implementation goal uses this stop: ordinary-browser journeys and the existing route-chaos replay pass through the new API/CLI with no Python runtime dependency; four isolated Vitest workers and two independent CLI clients on distinct tabs of one attached browser run without cross-talk; failure, cancellation, deadline, disconnect and hard-kill cases clean only owned resources; a persistent profile remains authenticated after restart; and a user-approved existing Chrome attachment operates without restarting or stopping that browser. All three modes are required. Manual sign-in and consent are checkpoints, not automated bypasses. Keep the same acceptance cases during later simplification and stop after two rounds produce no accepted reduction in duplication or caller obligations. The [frozen build contract](../../.artifacts/runs/browser-20261024-port/CONTRACT.md) names A1–A8; the ledger records actual proof rather than treating this plan as completion.

## Measured size

The implemented TypeScript runtime on 2026-10-24 has 12 source modules and 3,128 physical lines under `ts/packages/browser/src`, including embedded Windows lifecycle code. This excludes acceptance tests, fixtures, dependencies and generated protocol types. It is the selected adoption scope, not full upstream feature parity. Maintenance is concentrated in keeper/guardian shutdown, profile ownership and cross-process cancellation; ordinary protocol commands remain forwarding rather than separate handwritten domain wrappers.

Clone: [`.explore/chrome-agent`](../../.explore/chrome-agent), upstream commit [`ab3f3be6ef4c3be85546bf84aa8282b98456b97b`](https://github.com/captivus/chrome-agent/tree/ab3f3be6ef4c3be85546bf84aa8282b98456b97b), package version 0.7.1.

| Python scope | Files | Physical lines | Code lines |
|---|---:|---:|---:|
| Handwritten runtime | 18 | 6,066 | 4,086 |
| Generated CDP bindings | 55 | 9,409 | 5,607 |
| Shipped Python total | 73 | 15,475 | 9,693 |
| Tests and fixtures written in Python | 15 | 4,649 | 2,840 |
| Binding generator | 1 | 287 | 213 |
| Research and other Python scripts | 24 | 4,930 | 3,415 |

Code lines are physical lines carrying Python tokens, excluding comments, blanks, and AST-recognized docstrings. This is not a statement count or a raw newline count. Non-Python documentation, HTML fixtures, shell scripts, and lockfiles are excluded. [Replay script](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/analyze.py); [per-file census](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/source-census.json).

## Maintenance burden

**Moderate for the browser library; high for complete cross-platform parity.** These are engineering judgments based on the following code, not measured development hours.

| Area | Evidence | Maintenance judgment |
|---|---|---|
| CDP transport | [`cdp_client.py`](../../.explore/chrome-agent/src/chrome_agent/cdp_client.py), 136 code lines | Small, but needs cancellation, bounded requests, disconnect handling, and event-handler isolation. `send()` has no intrinsic deadline. A callback exception can end the shared receive loop. |
| Types and protocol | [`domains/page.py`](../../.explore/chrome-agent/src/chrome_agent/domains/page.py), [`generate_bindings.py`](../../.explore/chrome-agent/scripts/generate_bindings.py) | Generated volume is not handwritten work. Existing bindings return `dict`; object types alias `dict`, and enum aliases are `str`. A literal port would retain weak typing. |
| Browser lifecycle | [`launcher.py`](../../.explore/chrome-agent/src/chrome_agent/launcher.py), [`registry.py`](../../.explore/chrome-agent/src/chrome_agent/registry.py), [`utils.py`](../../.explore/chrome-agent/src/chrome_agent/utils.py) | Highest priority for Vitest safety. Global registry read/modify/write is unlocked. The fixed `.tmp` name and port/name allocation can race. `/proc` identity checks degrade outside Linux. These concurrency hazards are source findings, not reproduced races. |
| Snapshots and CLI | [`snapshot.py`](../../.explore/chrome-agent/src/chrome_agent/snapshot.py), [`cli.py`](../../.explore/chrome-agent/src/chrome_agent/cli.py) | 954 + 926 code lines, 46% of the handwritten runtime. Capture/restore includes profiles, cookies, tabs, subscriptions, virtual desktops, and recovery. This is a separate product-sized obligation from driving a test browser. |
| Platform integrations | [`desktop.py`](../../.explore/chrome-agent/src/chrome_agent/desktop.py), [`snapcrypto.py`](../../.explore/chrome-agent/src/chrome_agent/snapcrypto.py), [`supervisor.py`](../../.explore/chrome-agent/src/chrome_agent/supervisor.py) | Linux desktop tools, OS keyrings, archive encryption, detached processes, and auto-attached targets increase the platform matrix. |

The three declared runtime dependencies are `websockets`, `cryptography`, and `keyring`. The last two serve encrypted snapshots. The only checked-in workflow, [`publish.yml`](../../.explore/chrome-agent/.github/workflows/publish.yml), builds and publishes on Ubuntu; it does not run the test suite or establish Windows coverage. The git history attributes its 128 commits to one author. These are maintenance concentration signals, not proof that the package is abandoned.

The upstream already has real-browser tests. [`tests/conftest.py`](../../.explore/chrome-agent/tests/conftest.py) launches headless Chrome; [`test_cdp_client.py`](../../.explore/chrome-agent/tests/test_cdp_client.py) exercises CDP. The shared fixed port 9333 is unsuitable as the isolation model for parallel Vitest workers.

## Windows findings

### Confirmed upstream registry defect

[`registry.py:180`](../../.explore/chrome-agent/src/chrome_agent/registry.py#L180) writes a temporary file and calls `os.rename` over the existing registry. On this Windows machine the first public `register()` succeeds and the second raises `FileExistsError`, WinError 183. The experiment used a temporary registry and metadata-only entries; it launched no browser. [Reproducer](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/reproduce_windows.py); [result](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/windows-repro-3.14.json). Python documents this replacement behavior for [`os.rename`](https://docs.python.org/3/library/os.html#os.rename).

The installed tool is **0.6.0 with local changes**. Relative to upstream v0.6.0, its registry uses `os.replace`; `process_is_ours` also catches `OSError` for dead Windows PIDs. Both changes are absent from the cloned 0.7.1 source. [Exact installed diffs](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/installed-facts.json). Reinstalling upstream or porting its code literally can lose those repairs.

### Repeated encoding and environment failures

The history contains actual command/result pairs, not only agent explanations:

| Incident | Evidence and scope | Consequence for the port |
|---|---|---|
| `chrome-agent guide` crashes under cp1252 | October 1 [Claude thread](t3-thread://v1/581235a1-3fdc-4454-be28-5a0efe621fc5), October 4 [Codex thread](t3-thread://v1/a0d2c6b2-3af6-48e8-9cc8-1529870ab022); October 7 receipt `T0461`; October 23 delegated receipt `T4208`. Current replay exits 1 under cp1252 and 0 under UTF-8. | In-process TS calls avoid Python console encoding. A CLI must have a stable UTF-8 machine-output path. |
| Wrong Python environment | October 20 receipt `T1873` in [design-system performance](t3-thread://v1/d423bb4e-b2cd-4661-9cf3-0ad6eba88a23), October 21 receipt `T1980` in [Forma viewer](t3-thread://v1/211c43f6-243f-4a5d-b4d5-d7c9b7feb03f). `chrome-agent` is available while ordinary `python` cannot import `websockets`. Child receipts `T2068` and `T2905` cannot import `chrome_agent`. | One workspace dependency and one runtime remove this interpreter-selection seam. These are not demonstrated PATH lookup failures. |
| Shell/native path and quoting | October 1 native Python cannot open `/c/Users/...`; `C:/Users/...` works. October 4 orchestration JavaScript fails to parse before launching the tool. Original command/result pairs were rechecked. | Use structured arguments and direct library calls; avoid constructing JSON-bearing shell strings. |
| Empty status is prose | October 23 [route journey](t3-thread://v1/9749b3f3-bfbc-4693-988c-817e01c9abb1), message `V0310`, reported JSON parse failure. Source diff `022d3c2b`, receipt `T4084`, adds the special case now present in [`browserStatus`](../../ts/tests/e2e/route-chaos-launch.ts). | `list(): BrowserInfo[]` returns `[]`; any CLI JSON output must preserve that shape. This is a cross-platform output-contract problem. |

The October 11 [shell investigation](t3-thread://v1/ab655f9f-d924-46e7-adc8-88d95ba55f96) already distinguished encoding from lookup failure. The October 23 child failures show that its child-environment fix did not cover every harness invocation. That does not establish a new defect in the host's environment-capture implementation.

### Findings that must remain separate

- A child receipt `T3320` contains WinError 64 and connection refusal 10061. It proves a dropped/refused endpoint, not why that endpoint disappeared.
- Background throttling and T3 preview timeouts are recorded in `V0157`, `V0164`, and `V0311`. They are browser/harness conditions, not proven chrome-agent implementation bugs.
- Product lag observed through Chrome is not automatically driver lag. User message `V0228` reports slow typing in the app's search field.
- The suspected destructive effect of `os.kill(pid, 0)` did not reproduce on disposable children under Python 3.13.5 or 3.14.5 here. The later dead-child check returned `True` while the process handle remained retained; its broader meaning was not established. Do not report that helper as proven to kill Chrome or claim that the historical WinError 87 was freshly reproduced.
- Several WinError 183 hits were quotations of old memory, not fresh failures. They are explicitly excluded from recurrence evidence.

## Existing Pe.Tools integration

The immediate consumer already exists:

- [`ts/tests/e2e/cdp.ts`](../../ts/tests/e2e/cdp.ts): 637 physical lines, including browser interaction plus Pe.Tools-specific helpers. Its `send(method: string, params: object): Promise<any>` and event `params: any` are the missing protocol type boundary. `read<T>()` is an assertion, not runtime validation.
- [`route-chaos-launch.ts`](../../ts/tests/e2e/route-chaos-launch.ts): 418 physical lines. It owns source/runtime setup, calls the Python CLI, supplies UTF-8, tracks a custody receipt, and starts Vitest.
- [`route-chaos.test.ts`](../../ts/tests/e2e/route-chaos.test.ts): 1,545 physical lines of a reproducible real-browser journey.
- [`ts/package.json`](../../ts/package.json): existing `journey:routes` and `test:route-chaos` entrypoints.

These sizes are source observations at Pe.Tools `9beedb4eb4245090165a1d4a86ea1baa1e5d3d39`, not a claim that the journeys passed in this assessment. Reuse their consumer surface; do not start a second browser-test framework beside them.

## Implemented port

### 1. Typed protocol and owned lifecycle

The private workspace package is `@pe/browser`; its CLI is `pe-browser`. It uses pinned upstream `devtools-protocol` command mappings and retains arbitrary `sendRaw` calls returning `unknown`. Type declarations do not certify installed browser compatibility.

```ts
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

type Commands = ProtocolMapping.Commands;
interface CdpSession {
  send<M extends keyof Commands>(
    method: M,
    ...params: Commands[M]['paramsType']
  ): Promise<Commands[M]['returnType']>;
}
```

The sketch shows the known-command typing used by the [public implementation](../../ts/packages/browser/src/index.ts). `BrowserError` carries method, request id and outcome where available. Cancellation or timeout never replays a command; a sent mutation can have an unknown outcome.

`BrowserSession.info.custody` distinguishes owned and attached sessions. `close()` stops an owned browser; on an attached session it closes created tabs and disconnects. Borrowed pages can only be released. Privileged raw CDP remains available and is not a security boundary.

Owned sessions use isolated disposable profiles unless a retained profile is explicit. Session receipts bind browser identity, endpoint, profile and process custody. Each keeper owns immutable readiness and terminal publications. The public status reader combines those publications with guardian cleanup evidence; a raw readiness file saying `active` is not a liveness check. Attachment exclusion spans explicit browser-home and product-home overrides through the canonical OS-user state namespace.

### 2. Adopt it in the current journeys

The existing [CDP adapter](../../ts/tests/e2e/cdp.ts) and [route launcher](../../ts/tests/e2e/route-chaos-launch.ts) use the package without Python. Vitest still runs in Node and drives actual Chrome; no Browser Mode provider was added.

Real acceptance covers four independent workers, shared attached clients, target contention, failed launches, cancellation, disconnect and hard kills. Process cleanup is supervised rather than dependent on JavaScript finalizers alone. Windows is the native proof platform; other operating systems are not certified by these runs.

### 3. Prove behavior at the surface

Use real Chrome and the real public library, without mocked CDP or process APIs. Drive the existing product journey and a small browser fixture through trusted input. Check invariants throughout the sequence, because a final screenshot can hide an earlier state loss.

Required acceptance scenarios:

1. Two concurrent workers launch distinct browsers and profiles. Each sees only its intended page. Disposing one leaves the other alive.
2. An attached foreign browser survives disposal, failure, and interrupted test-runner cleanup.
3. A failed launch, failed assertion, deadline, dropped socket, and killed worker leave a useful receipt and remove only owned resources. Do not silently reuse stale target or DOM handles after reconnect.
4. Navigation, a popup, a worker target, reload, input, a console error, network failure, and screenshot capture travel through real CDP. Arm observations before the action that triggers them.
5. Spaces and non-ASCII characters in paths, titles, and input work on Windows. Retained profiles are explicit; ephemeral test profiles never silently reuse the user's signed-in browser.
6. Replay the existing route-chaos seed, with intermediate checks for URL/history, selected system, staged Work, thread identity, reconnect behavior, and console/network failures. Report failures where they first occur.

Compiler checks reject invalid known-command arguments. Attached close semantics are enforced at runtime and tested against real browsers. These checks complement the browser journey.

### Later parity, if required

The CLI is implemented in the first adoption scope. Encrypted profile snapshots, keyring storage, cross-desktop restoration, fingerprint profiles, shell completions and detached border supervisors remain deferred until a concrete consumer needs them. Dynamic CDP access does not require those Python features or locally generated domain files.

The 4,086-code-line handwritten Python baseline describes the broader upstream product. This port targets ordinary browser automation, concurrent Vitest use and a dynamic CLI. Its real route gate requires refresh, reconnect and worker recovery. Optional thread/arming coverage remains explicitly omitted rather than reported as passed.

## Mining method and proof limits

Window: September 23, 2026 00:00 America/Chicago through the start of this request on October 23, 2026 21:42. Project id `72b0f376-b12f-4c40-adf9-afd856c8d944`; this thread excluded.

The existing extractor supplied the baseline. It reads legacy T3 tables and skips compressed Codex `.jsonl.zst` files. Supplemental scripts read T3 v2 in consistent SQLite transactions and decompressed the specific canonical records needed for verification.

The v2 scan considered 26,468 project messages and 93,211 tool receipts. Lexical selection retained 344 messages and 4,599 tool receipts. Twenty tool candidates received explicit semantic adjudication in this pass; the rest remain candidates, not counted failures. Eleven older command/result sides were independently rechecked for full source hash and call/result identity. All eleven matched. Root user reports, assistant testimony, delegated work, imported threads, and repeated memory quotations remain distinguishable.

Evidence is self-contained in [the dated run](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine): [source census](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/source-census.json), [v2 inventory](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/v2-inventory.json), [tool inventory](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/tools-inventory.json), [story ledger](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/stories.json), [original-record verification](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/historical-verification.json), and [limits](../../.artifacts/runs/deterministic-20261023-chrome-agent-mine/summary.json). Candidate ids identify rows in the JSONL files. Their source item ids and hashes preserve lineage.

Three native inputs changed during the initial legacy extraction. The v2 message pass showed no before/after file-signature drift. The tool pass used its own SQLite snapshot; cross-pass atomicity is not claimed. Retention and lexical selection prevent an exhaustive semantic failure-rate claim.

`PROVEN[artifact, source census + verified historical record pairs in the dated run, upstream ab3f3be6 / Pe.Tools 9beedb4e, 2026-10-23]` applies to the measured source and preserved evidence only.

`FALSIFIED[native Windows, upstream second registry write raises WinError 183; installed guide fails under cp1252 and succeeds under UTF-8]`.

`UNPROVEN[complete upstream feature parity, exhaustive incident frequency, actual Google account persistence, Helium, and non-Windows lifecycle behavior]`. Current implementation proofs are linked from the [browser ledger](../features/browser/LEDGER.md).

All disposable child processes were reaped. Temporary registry directories were removed. No Chrome, Revit, host, server, worktree, or subagent was started by this assessment. The requested clone and research artifacts remain.
