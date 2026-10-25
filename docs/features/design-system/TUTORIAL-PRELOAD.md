# Tutorial before loading

The user approved one map renderer with two fact sources, then asked to build and prove it before changing style. The earlier prose loading experience did not meet that request. `DuctsIntroduction` remains documentation only. No second map renderer, hidden screen mount, metadata solve, new dependency, persisted Work state or fake fact registration was added.

Implementation commits: `9717cf17aaa06bced2916fdfb6725c4d3a90a68e` (map and shared declarations), `76f6645472153e975d9ebac4d4fa5e738ed28381` (private unused dock export), `0314a8b945f9d98a80c8e2f4327391b9d510f775` (tool-source isolation and shared list actions), and `20ec8e7c529d219d3174fb0ba510e1901ed480ee` (static leader geometry, 2026-10-24 23:15:57 -05:00). The app supplied a clean isolated worktree at `eea0d18c`, three Pane commits after requested `dcdaacd3`; those commits were preserved.

## Census and lineage

Before editing, `HelpWorld` already rendered mounted `Teaching[]`; `Pane` declared regions, `useTeach` registered controls, and `teach-measure.ts` measured mounted rectangles. `LeaderDiagram` emitted empty paths until its layout effect. Root admission showed generic prose. `EScreen` used `DuctsIntroduction` during snapshot/pricing, while `ducts/docs.tsx` used it as narrative. No pre-load map source existed.

| Authority | Reference consumer | Loaded consumer |
| --- | --- | --- |
| [DUCTS_LAYOUT and DUCTS_REGIONS](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | `declaredTeaching` projects split rectangles, labels and purposes | [EScreen](../../../ts/apps/web/src/ducts/proto/e/screen.tsx) renders the same split tree through `TeachingLayoutView`; pane titles/help use the region definitions |
| [DUCTS_PICTURE_MODES and DUCTS_LAYER_OPTIONS](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | Picture mode/layer callouts | [ECanvas](../../../ts/apps/web/src/ducts/proto/e/canvas.tsx) supplies the same options to `Pane` |
| [STAGE_ACTIONS](../../../ts/apps/web/src/scene/stage-teaching.ts) | `actionTeaching` projects labels, descriptions and bindings without registration | [stage-controller.ts](../../../ts/apps/web/src/scene/stage-controller.ts) attaches callbacks and calls `actionScopeKeys` |
| [LIST_ACTIONS and search syntax](../../../ts/packages/kit/src/components/lang/list-teaching.ts) | List keys and search callouts | [collection.ts](../../../ts/packages/kit/src/components/lang/collection.ts) and [list-search.tsx](../../../ts/packages/kit/src/components/lang/list-search.tsx) consume those declarations |
| [ORBIT_GESTURES](../../../ts/apps/web/src/scene/gestures.ts) | Picture gesture callouts | `useStageKeys` and the existing picture gesture implementation |
| [SHELL_REGIONS](../../../ts/apps/web/src/route/teaching.ts) | Generic public first-paint map | `AppBar` and root workspace use the same identity labels |

The kit contract is [teach.ts](../../../ts/packages/kit/src/components/lang/teach.ts). React split rendering is [teaching-layout.tsx](../../../ts/packages/kit/src/components/lang/teaching-layout.tsx); current registration, page selection and fallback are [use-teach.ts](../../../ts/packages/kit/src/components/lang/use-teach.ts). Both sources reach [HelpWorld](../../../ts/apps/web/src/route/help.tsx) and [LeaderDiagram](../../../ts/packages/kit/src/components/lang/leader-diagram.tsx). The reference specimen sits beside the mounted Tutorial in [pane-strip.tsx](../../../ts/apps/web/src/design-system/specimens/pane-strip.tsx).

Source links above resolve from this file's actual directory. Three parent steps reach the checkout root; four steps would leave this worktree.

## Boundaries

- The static SPA artifact has one `index.html`; it cannot know the requested route. It contains the generic public map, including boxes, callouts and nonempty SVG leader paths. Initial hydration uses that same map. An effect then selects Ducts only for `/ducts`; other routes retain the generic map until they have their own declaration.
- `RemoteDeviceGate` still admits children only for local or paired devices. Root supplies public guidance. Connection errors retain the map and retry; unpaired devices see the map and pairing controls. Public facts contain no document title, selection or current action availability.
- Declarations are passed directly, never seeded into the mounted registry. Projection removes active/disabled/refusal values. `useTeaching` never reads the process-global registry for its server snapshot.
- `TeachPage` tags tool sources. `TeachTarget` lets chrome read the current tool without tagging sibling chat panes as tool facts. Reference facts remain while that tool has no measured regions; measured tool facts replace them as one set. Global key facts join only the measured result.
- Reference geometry shows declared support panes expanded, at a reference viewport. Current fold state, persisted widths, document-specific system names, dynamic search facets, selection and refusal belong to mounted measurements. The initial SVG leaders connect numbered markers to region edges entirely in declared map coordinates; layout effects hide those markers and draw measured leaders to the composed callouts. No label coordinates are guessed before layout. Responsive narrow layouts retain numbered callouts and hide cross-column leaders, as before.

## Proof

Machine evidence and disposable harnesses: `.artifacts/runs/browser-20261024-tutorial-preload/` in this preserved worktree. The directory README names the question. Logs retain failures as well as successful reruns.

- Install: `vp i --frozen-lockfile --prefer-offline`, from `ts`, exited 0; 760 packages, no lockfile changes.
- Deterministic: 21 focused web tests passed in `final-focused.log`; the three suites affected by the final static-leader change passed all 18 tests in `static-leader-tests.log`. [teaching.test.tsx](../../../ts/apps/web/src/route/teaching.test.tsx) changes shared action/split definitions and checks both projections; it checks runtime-state removal, shell/retained-route exclusion, empty-live fallback, SSR registry isolation and hydration without warnings. [loading-context.test.tsx](../../../ts/apps/web/src/route/loading-context.test.tsx) drives the actual admission and `EScreen` snapshot/pricing/error branches. Existing measured geometry and stage tests passed too.
- Kit: the first targeted invocation incorrectly forwarded arguments through a compound package script. Its Vitest phase passed all 204 tests, then Node tried to execute the TypeScript file. The corrected package-root command passed 51 tests; command and result are in `list-tests-corrected.log`.
- `pnpm verify` ran from `ts` with complete Node-captured stdout/stderr. First run stopped at unused exports. Untouched `eea0d18c` independently reproduced `DOCK_FLOOR` in `baseline-knip-eea0d18c.log`; making that constant private changes no behavior. Two later runs were stopped when browser evidence required source-isolation and static-leader corrections; neither is reported as a completed gate. The completed run is `verify-complete.log`: exit 1 at 2026-10-25 04:29:16 UTC. Check, knip, kit build and every non-host package passed; web passed 518 tests with 2 skips. Host passed 543 tests with 1 skip and failed 3 demo browser cases. The gate did not reach guards or R24. The separate final-source guard run passed all 110 tests in `guards.log`; R24 was not run because this change adds no C# behavior.
- Production artifact: `vp build` from `ts/apps/web` emits `dist/client/index.html`; `build-complete.log` is the final build log (exit 0, 2026-10-25 04:16:36 UTC). Static shell inspection and browser script-disabled capture show usable public anatomy before JavaScript.
- Browser: T3 preview status/open used an owned explicit tab. Page evaluation worked, but two snapshots timed out at 15 seconds and animation frames did not advance. The alternate browser inventory was empty. The repo's `@pe/browser` then owned a headless Chrome session, saved screenshots and JSON state, and closed it in `finally`. No user browser, host or Revit session was started or stopped.

The browser harness serves actual `dist/client` assets. Its injected script holds the environment response or worker submission, records errors/warnings, and supplies an explicitly synthetic local admission. `?demo=navigation` is the existing synthetic route fixture, with native actions disabled. Unimplemented host APIs return harness errors; no request is forwarded to a native host. These delays prove presentation transitions, not model speed.

PROVEN[artifact, `dist/client/index.html` SHA-256 `3e601ebc73f25bcaad05d89047920d315c787145ef298fc11be6d441828820ae`, `20ec8e7c529d219d3174fb0ba510e1901ed480ee`, 2026-10-25 04:16:36 UTC]. PROVEN[browser, owned Chrome fixture harness and `browser-evidence.json`, `20ec8e7c529d219d3174fb0ba510e1901ed480ee`, 2026-10-25 04:17:45–04:17:55 UTC]. The browser assertions check all expected leader paths, early protected-screen absence, and empty warning/error records, including opening Tutorial while pricing is held.

| Browser case | Expected behavior |
| --- | --- |
| `pre-javascript.png` | Generic map, two regions and nonempty leaders; application scripts disabled |
| `blocked-host.png` | Ducts reference map; only environment admission requested; protected screen absent |
| `host-error.png`, `unpaired.png` | Reference map survives failure/pairing; protected screen absent |
| `no-document.png` | Actual Ducts route keeps its map with no document snapshot |
| `delayed-pricing.png`, `pricing-tutorial.png` | Actual route and opened Tutorial retain the reference map while the fixture's worker submission is held |
| `mounted-tutorial.png` | Current measured Tutorial after releasing that worker and opening the route's Tutorial |
| `other-route.png` | Unsupported `/family` admission uses the generic map, with no Ducts facts |

Browser slow native snapshot acquisition has not been exercised. The absent-snapshot branch and its transitions are deterministic-tested on the actual `EScreen`; the built browser covers absent document and delayed pricing. No native mutation, lifecycle operation, host restart or installed-root change was performed. A read-only navigation inventory was inspected, but it was not used as native behavior proof.

UNPROVEN[browser slow native snapshot response; not exercised in this bounded presentation run]. The review server and T3 tab were closed; the owned screenshot browser closed in `finally`. The worktree and its evidence remain for parent proof.

## Gate failure and baseline comparison

The three host cases are Schedules capture/apply, Family capture/apply, and Families retained-readback/repeat plans in [demo-lane.scenario.test.ts](../../../ts/apps/host/tests/demo-lane.scenario.test.ts). All failed before their capture/read click: the button was visible, enabled and stable, but sibling Pea content (`No provider is ready` or `Chat here`) intercepted the pointer. The native apply operation was not the failing assertion.

Untouched `eea0d18c` independently reproduces the Schedules interception in `baseline-schedules-eea0d18c.log` (exit 1, 2026-10-25 04:31:06 UTC). Command from `ts/apps/host`: `vp test run tests/demo-lane.scenario.test.ts --testNamePattern=schedules`. That test starts its own temporary no-Revit host/frontend and closes them. Family and Families were not separately rerun on baseline; their common blocker is an observation from the implementation run, not a claim that their complete workflows pass on baseline. No unrelated chat behavior was changed to make this gate green.

FALSIFIED[browser, host demo capture/read clicks intercepted by sibling Pea content; full workspace gate exits 1]. FALSIFIED[browser baseline, Schedules capture is also intercepted on untouched `eea0d18c`]. PROVEN[deterministic, 110 repo guards and focused Tutorial/list suites, `20ec8e7c529d219d3174fb0ba510e1901ed480ee`, 2026-10-25 04:32:28 UTC]. The saved build and presentation cases remain valid; a fully green `pnpm verify` is not claimed.

## Repeat

From this checkout, install in `ts`, then run `pnpm verify`. Build with `vp build` in `ts/apps/web`. From the checkout root:

The focused web command, from `ts`, is `pnpm --filter @pe/web test run src/route/teaching.test.tsx src/route/loading-context.test.tsx src/design-system/specimens/teach.test.tsx src/scene/stage-controller.test.tsx`. The list regression command, from `ts/packages/kit`, is `vp test run tests/list-core.test.tsx`. Do not forward those arguments through kit's compound `test` script.

Start the disposable artifact server from the checkout root:

```powershell
node .artifacts/runs/browser-20261024-tutorial-preload/serve.mjs
```

In another terminal, from the same root:

```powershell
node .artifacts/runs/browser-20261024-tutorial-preload/browser-proof.mjs
```

Review `http://127.0.0.1:5216/ducts?proof=blocked`, `/ducts?demo=navigation&proof=pricing`, or `/family?proof=blocked`. For pricing, `window.__tutorialProof.releasePricing()` releases the artificial worker hold. The harness is disposable evidence, not a product feature or a committed review route. Stop its terminal with Ctrl+C. The standard unmodified frontend review command remains `vp preview --port 5216 --strictPort` from `ts/apps/web`; it needs an admitted host for protected content.

## Change depth

Before documentation: 25 files, +813/-246 lines. Six buckets: kit contract/projection/measurement and shared controls (9); Ducts declaration/runtime consumption (4); web admission/composition (5); scene declarations/consumption (2); specimens/tests (4); private-export gate cleanup (1). Three documentation files bring the delivered file count to 28. No CSS redesign, dependencies, compatibility bridge, feature flag or alternate map renderer. Added shim count: zero. Reference depth is definition → projection → `HelpWorld`; live depth remains primitive → registration/measurement → `HelpWorld`.
