# Tutorial before loading

The user approved one map renderer with two fact sources, then asked to build and prove it before changing style. The earlier prose loading experience did not meet that request. `DuctsIntroduction` remains documentation only.

Implementation: `9717cf17`, `76f66454`, `0314a8b9`, `20ec8e7c`. Integration with main `e764bd1e`: `638539ce`. Current multi-system test fixture: `92f19b49`. Pea ownership correction: `842fd5e71723cc86bb8318e2a27268be7e3e9a0a`.

## Census and lineage

Before editing, `HelpWorld` rendered mounted `Teaching[]`; `Pane` declared regions, `useTeach` registered controls, and `teach-measure.ts` measured mounted rectangles. `LeaderDiagram` emitted empty paths until its layout effect. Root admission and Ducts loading used prose. No pre-load map source existed.

| Authority | Reference consumer | Loaded consumer |
| --- | --- | --- |
| [DUCTS_LAYOUT and DUCTS_REGIONS](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | `declaredTeaching` projects split rectangles, labels and purposes | [EScreen](../../../ts/apps/web/src/ducts/proto/e/screen.tsx) renders that split tree through `TeachingLayoutView`; pane titles/help use the region definitions |
| [DUCTS_PICTURE_MODES and DUCTS_LAYER_OPTIONS](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | Picture mode/layer callouts | [ECanvas](../../../ts/apps/web/src/ducts/proto/e/canvas.tsx) supplies the same options to `Pane` |
| [STAGE_ACTIONS](../../../ts/apps/web/src/scene/stage-teaching.ts) | `actionTeaching` projects descriptions and bindings without registration | [stage-controller.ts](../../../ts/apps/web/src/scene/stage-controller.ts) attaches callbacks and calls `actionScopeKeys` |
| [LIST_ACTIONS and search syntax](../../../ts/packages/kit/src/components/lang/list-teaching.ts) | List keys and search callouts | [collection.ts](../../../ts/packages/kit/src/components/lang/collection.ts) and [list-search.tsx](../../../ts/packages/kit/src/components/lang/list-search.tsx) consume those declarations |
| [ORBIT_GESTURES](../../../ts/apps/web/src/scene/gestures.ts) | Picture gesture callouts | `useStageKeys` and the existing picture gesture implementation |
| [SHELL_REGIONS](../../../ts/apps/web/src/route/teaching.ts) | Generic public first-paint map | `AppBar` and root workspace use the same identity labels |

The kit contract is [teach.ts](../../../ts/packages/kit/src/components/lang/teach.ts). Runtime splits use [teaching-layout.tsx](../../../ts/packages/kit/src/components/lang/teaching-layout.tsx); registration, page selection and fallback are in [use-teach.ts](../../../ts/packages/kit/src/components/lang/use-teach.ts). Both sources reach [HelpWorld](../../../ts/apps/web/src/route/help.tsx) and [LeaderDiagram](../../../ts/packages/kit/src/components/lang/leader-diagram.tsx). The reference specimen sits beside mounted Tutorial in [pane-strip.tsx](../../../ts/apps/web/src/design-system/specimens/pane-strip.tsx).

## Boundaries

- One SPA `index.html` cannot know the requested route. It contains the generic public map, including boxes, callouts and nonempty SVG leaders. Initial hydration uses that map. An effect selects Ducts only for `/ducts`; other routes retain generic guidance until they declare their own.
- `RemoteDeviceGate` still admits children only for local or paired devices. Connection errors retain the map and retry; unpaired devices see the map and pairing controls. Public facts contain no document title, selection or current action availability.
- Declarations are passed directly, never seeded into the mounted registry. Projection removes active/disabled/refusal values. Server snapshots never read the process-global registry.
- `TeachPage` tags sources. `TeachTarget` lets chrome read the current tool. A local source takes precedence: [ChatShell](../../../ts/apps/web/src/chat/chat-shell.tsx) owns Pea facts even when docked beside Ducts. Reference facts remain until that source has measured regions; measured facts replace them as one set.
- Reference geometry expands declared support panes at a reference viewport. Current fold state, persisted widths, document-specific names, dynamic search facets, selection and refusal belong to mounted measurements. Static leaders use declared map coordinates; layout effects replace them with leaders to composed callouts. Narrow layouts retain numbered callouts and hide cross-column leaders.
- No hidden screen/WebGL mount, metadata solve, new dependency, persisted state, fake registration, feature flag or extra SSR runtime was added. Styling remains for the next user review.

## Proof

Evidence and repeat harnesses are in `.artifacts/runs/browser-20261024-tutorial-preload/`. Logs retain failed attempts as well as successful runs. The final browser result is `parent-final-browser/browser-evidence.json`.

- Production artifact: `parent-final-build.log`, exit 0 on `842fd5e7`, 2026-10-25 04:52 UTC.
- Deterministic: `parent-final-focused.log`, 29 tests across six suites, exit 0 at 04:52:51 UTC. Tests exercise shared action/split definitions, removal of runtime flags, admission and actual `EScreen` loading/error branches, retained-route isolation, SSR registry isolation and hydration. The Pea ownership test first failed (`parent-chat-red.log`), then passed with the fix.
- Shared list behavior: 51 tests passed in `parent-list.log`. Repo guards: 110 passed in `parent-guards.log`.
- Final-source complete `pnpm verify`: `parent-verify-serial.log`, exit 0 at 2026-10-25 05:10:12 UTC. This included web (525 passed, two skipped), host (546 passed, one skipped), browser (nine passed), 110 guards, and R24 compilation (zero errors). Check, knip and all package suites passed. The earlier integrated gate also passed (`parent-verify.log`).
- One earlier final-source run stopped in unchanged browser-package A7 cleanup: Chrome required forced termination (`parent-final-verify.log`). A7 passed in isolation (`parent-browser-a7-isolated.log`) and in the final quiet full gate. No browser implementation was changed to clear that failure.
- Built browser: all 11 cases passed on `842fd5e7` at 04:54:49 UTC, with no captured hydration warnings/errors and clean owned-browser shutdown. `parent-final-browser-fixed.log` exits 0.

The browser harness serves actual `dist/client` assets. Its injected script holds the environment response or worker submission and supplies synthetic local admission. `?demo=navigation` is the existing synthetic route fixture, with native actions disabled. Other host APIs return harness errors; nothing is forwarded to a native host. These holds prove presentation transitions, not model speed.

| Browser case | Observed behavior |
| --- | --- |
| `pre-javascript.png` | Generic map and nonempty leaders with application scripts disabled |
| `blocked-host.png` | Ducts reference map; only environment admission requested; protected screen absent |
| `host-error.png`, `unpaired.png` | Map survives failure/pairing; protected screen absent |
| `no-document.png` | Actual Ducts route retains its map without a document snapshot |
| `delayed-pricing.png`, `pricing-tutorial.png` | Route and opened Tutorial retain reference guidance while worker submission is held |
| `mounted-tutorial.png` | Measured Ducts Tutorial after worker release |
| `docked-chat-tutorial.png`, `pea-tutorial.png` | Pea owns its Tutorial beside Ducts and on its main route |
| `other-route.png` | Unsupported `/family` admission uses generic guidance without Ducts facts |

T3 preview evaluation worked, but two snapshots failed with `Preview automation snapshot timed out after 15000ms.` The repo's `@pe/browser` owned the fallback Chrome session. All created browser sessions, preview tabs and the artifact server were closed. No user browser, native host or Revit session was started or stopped.

PROVEN[artifact/browser, production SPA in owned fixture harness, `842fd5e7`, 2026-10-25 04:54:49 UTC]. This proves static and hydrated map behavior and transition to measured facts. UNPROVEN[delayed native snapshot acquisition and installed/Revit behavior; no speed or native-runtime claim]. The actual absent-snapshot branch is deterministic-tested; the built browser covers absent document and delayed pricing.

PROVEN[deterministic/compile, complete workspace `pnpm verify` including R24, `842fd5e7`, 2026-10-25 05:10:12 UTC].

The earlier child gate failed three host demo clicks on its old base; baseline `eea0d18c` also reproduced Schedules interception. Integration with current main resolved those cases, and the complete integrated gate passed. Those historical failures remain in the evidence logs.

## Repeat

From `ts`: `pnpm verify`. From `ts/apps/web`: `vp build`.

From the checkout root, run `node .artifacts/runs/browser-20261024-tutorial-preload/serve.mjs`, then in another terminal `node .artifacts/runs/browser-20261024-tutorial-preload/parent-final-browser-proof.mjs`. Review `http://127.0.0.1:5216/ducts?proof=blocked` or `/ducts?demo=navigation&proof=pricing`. `window.__tutorialProof.releasePricing()` releases the artificial worker hold. Stop the server with Ctrl+C.

The harness is disposable evidence, not a committed review route. Standard frontend review remains `vp preview --port 5216 --strictPort` from `ts/apps/web` and needs an admitted host for protected content.

## Change depth

The implementation and tests change 26 source/package files; three documentation files describe the decision and proof. The largest change replaces the existing Ducts split JSX with its shared declaration.

| Change | Shim assessment |
| --- | --- |
| Shared layout and control declarations | Structural: actual controls and map consume one authority |
| Generic startup and Ducts loading composition | Direct use of the existing renderer |
| Reference rectangles and static leaders | Deliberate reference approximation; current geometry still comes from measurement |
| Page ownership and empty-server snapshot | Corrects source identity and server isolation |
| Private unused dock export | Small verification cleanup; no behavior change |

Compatibility shims added: zero. Going deeper would mean declaring other routes' real layouts, not adding another rendering engine. Caching large data and sharing compute across tabs remain separate work.
