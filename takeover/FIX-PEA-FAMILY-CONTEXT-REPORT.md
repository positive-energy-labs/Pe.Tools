# Fix Pea Family context

Branch: `fix/pea-family-context`. Base: `cb4f12f95addc45b427722e91e41146b9d639baf`.
Implementation: `184fed12b95a8df2d8c50f9f34352ab0ad9580a0` (includes `08af032e` and `73eabbe3`). No merge or push.
Source delta: +91/-19 across 10 TypeScript files. No new tests, dependencies, or generated source changes.

## Cause and route binding trace

The Family drawing mounted. Its lease did not survive folding the tools pane before the first conversation existed. The browser also omitted the built-in discovery bootstrap, and Pea's Work fallback chose document-bound Work instead of the host-bound Work displayed by Family.

1. `ts/apps/web/src/routes/family.tsx:8` mounts `TypedShell` with the typed Family declaration. All generated typed route entries use this kernel. `ts/apps/web/src/shell/typed-shell.tsx:49` resolves the Place and mounts its Work/Page owner.
2. The mount publishes its semantic Place reader through `observeSubject` at `ts/apps/web/src/shell/typed-mount.ts:567`. `ts/apps/web/src/shell/subject.ts:32` owns the reader registry, and `subjectState` at line 54 resolves a current reader. This is browser Place authority, not a durable thread binding.
3. Executable discovery is a different registry: `ts/apps/web/src/shell/route-registration.ts:6` registers typed declarations in `publicRoutes`. `ts/apps/web/src/route/builtin-routes.tsx:7` supplies the built-in bootstrap. On the base, no production module imported that bootstrap. The fix imports it at `ts/apps/web/src/routes/__root.tsx:1`. The prior browser visibly returned `Unavailable route: family` while rendering the Family drawing.
4. On the base, `TypedChrome` called `useRouteViewBridge` inside the drawing at `ts/apps/web/src/shell/typed-shell.tsx:111`. `ts/apps/web/src/route/view-bridge.ts:101` selects explicit thread or URL `?thread`; line 135 requires a thread and current, visible view; line 164 PUTs `view.publish`. Its passive-effect cleanup at lines 187-211 retires the lease.
5. `ts/packages/kit/src/components/lang/pane-resize.tsx:589` hides a folded pane with React Activity. Activity disconnects passive/layout effects. `ts/apps/web/src/workbench/route-retention.tsx:44` already documents this exact lifetime boundary. A retained drawing is therefore not a retained lease publisher.
6. `ts/apps/host/src/pe-routes.ts:321` creates `RouteViewStore` over host admissions. PUT at line 712 stores the lease. GET at line 720 selects it. `ts/packages/runtime/src/route-view-store.ts:71` selects by thread, route, optional instance and freshness; line 88 emits `no mounted ${route} view; ...`.
7. `ts/packages/mcps/src/pea/capability-tools.ts` forwards `route:<key>.view` to that HTTP GET. The base `documentWork` helper (now line 1064) classified all registry Work except two named exceptions as document-owned. Consequently `route:family` read the thread document's empty Work instead of the displayed host Work. The new generic mounted scope at line 921 uses the mounted Work key for reads, edits and history. Explicit per-call targets still override it.

The exact string `No Family view mounted` is not a source literal. The source refusal is the dynamic lower-case message at `route-view-store.ts:88`; Pea paraphrased it in rendered text. Screenshot 154 alone is not answer evidence.

## What the Driver evidence rules out

Evidence root, read-only: `C:/Users/kaitp/source/repos/Pe.Tools-drive/.artifacts/accept/solcb4/`.

- `ui/continuation-1516/trace.jsonl:691` shows the Family URL, Work r3 and the attached member before a thread existed. Line 707 records the explicit `Expand pea` action. Lines 769 and 783 show the same Family URL with the tool pane folded, before Send. Line 790 records Send. Line 809 shows the resulting `32289562-c198-4b8f-9e2d-4c0a19551628` URL.
- The real thread's `events.jsonl:5` records that one prompt. Line 59 contains the tool's empty document-bound Family Work (`revision:0`, `spec:null`). Line 65 contains the `route:family.view` refusal with no instances. The Driver host log confirms the corresponding GET returned 409 at lines 20910-20913. The rendered answer is in `trace.jsonl:990`.
- The thread was created at `2026-11-07T15:21:25.860Z`, after Family was already displayed. This was not a thread created before the Family mount. It needed its retained Place associated when first Send supplied the thread.
- `Fans` was not a route binding. `ts/apps/host/src/navigation.ts:98` associates document Work through the remembered document. `ts/apps/web/src/chat/thread-work.ts:41` chooses the most unfinished Work, and `thread-palette.tsx:858` uses that lead. The original thread metadata ultimately records Family host Work, not a Fans Place. The new explicit Place label at `thread-palette.tsx:862` separates these meanings.

FALSIFIED[browser/HTTP, cb4f12f9 Driver trace line 707 through durable event line 65: folding before first Send loses the Family lease and the fallback reads empty Work]

## Generic implementation

- `typed-shell.tsx:186` owns a small retained Place-view registry. The drawing updates its snapshot; insertion cleanup removes it only on actual removal. `PublishedPlaceViews` at line 216 runs outside the foldable drawing in `workbench/route-panes.tsx`. It uses the current URL thread, so selecting a thread while folded rebinds the lease. It renders after RouteRetention settles the Place identity. Hidden Page mutations refuse until the drawing is revealed.
- The typed snapshot carries document identity and the Work key, not copied Work contents. Host `pe-routes.ts:723` decodes that key and reads authoritative current Work into the view response. The MCP adapter uses that same mounted scope for Work operations. No Family branch was added to the kernel.
- `navigation.ts:73` projects the last explicitly remembered Place. `thread-work-context.ts:145` moves a revisited Place to the end without duplicating its association. The row displays its route name independently of unfinished Work counts.

## Green surface evidence

Disposable evidence: `.artifacts/pea-context/`. The source Host ran with `--no-revit --no-tray`, isolated product home, backend `127.0.0.1:52145`, frontend `127.0.0.1:5174`. The browser used the typed Family route and the copied real Driver thread. The host source files exercised are unchanged between `08af032e` and final implementation `184fed12`; the browser exercised the final source.

- `surface-http-visible.json`: real HTTP GET backing `route:family.view` returns the browser-published thread/instance, `context.work={route:family,binding:host,target:null}`, and authoritative Work r3.
- `folded-ui.json` records `Expand tools`, confirming that tools were folded, and the row `Chadds-solcb4 ... Family`. `surface-http-folded-expired.json` reads the same mounted Work after more than the 15-second expiry window. Its spec is `497868_IOM_MUAS_EN_20241220_174229048.pdf`, 24 pages and 312 blocks, attached to the exact `family-rename-proof/settings/family/Fantech---Duct-Silencer_LD-Series-2026-09-19T03-18-16-299Z.json` member.
- While still folded, selecting another real thread changed the URL to `f5d3adf1-0ef4-4e74-b2be-d2ef87ae5c01`. `old-thread-after-switch.json` records 409 for the old thread. Selecting the Driver thread again restored 200 with Work r3 and its spec (`rebound-thread.json`, `rebound-ui.json`). This exercises rebinding, not merely initial publication.
- Work contains a family reading reference, not the full LD 10 profile body. Exact LD 10 confirmation remains the Driver's independent evidence; no PDF engineering value was proposed or inferred here.
- `events-unchanged.json` records equal SHA-256 hashes for the original read-only Driver events and the copied thread events. No model turn ran.

PROVEN[browser and HTTP, .artifacts/pea-context/surface-http-folded-expired.json plus rebound-thread.json and folded-ui.json, 184fed12b95a8df2d8c50f9f34352ab0ad9580a0, 2026-11-07]

This is the real HTTP path used by `route:family.view`; it is not a claim that a new ACP/model turn or end-to-end MCP client turn ran.

## Every typed route

All 18 built-in typed declarations use the same registration/mount path: bind, captures, chat, design-system, duct-loss, ducts, families, family, fans, home, open, ops, pods, rooms, schedules, session-admin, settings and takeoffs. The root bootstrap now registers all of them; Pod registrations continue through the same `registerTypedRoute` function.

`typed-route-census.json` probes the real host view lookup for all 18. Family returned 200; 15 other route keys returned 409 (recognized channel, no such mounted view). Two existing non-Work aliases returned 404: `chat` and `session-admin`. Host `RouteWorkspace.admittedRoutes` projects Work admissions; legacy addresses cover most non-Work routes, but not these two typed names. These alias gaps are recorded, not certified or expanded into this one Work-context repair.

PROVEN[HTTP census, .artifacts/pea-context/typed-route-census.json, 184fed12b95a8df2d8c50f9f34352ab0ad9580a0, 2026-11-07]
UNPROVEN[live rendered binding for every other typed route; only Family was surface-driven. chat and session-admin retain existing non-Work alias gaps]

## Validation

No new unit tests and no full product suites ran. Existing affected suites only, plus the requested guards/build checks:

| Check | Result / evidence |
| --- | --- |
| Web route panes, hosted route, provider view, thread palette | 32 passed; `web-suites-final.log` |
| Final route panes and route discovery after bootstrap/order fix | 26 passed; `web-final-order.log` |
| Host route-document restore and navigation | 13 passed; `host-suites.log` |
| MCP capabilities | 10 passed, 1 inherited failure; `mcps-green.log` |
| Same MCP suite with untouched cb4f12f9 adapter source | Same one failure; `mcps-base.log` |
| Guards, maxWorkers=1 | 199 passed / 29 files; `guards-final.log`. Used testTimeout=30000 after the first loaded-machine run hit 5-second timeouts; no assertions were weakened. |
| Host `vp exec tsc --noEmit` | Passed, exit 0; `host-tsc-stable.log` / `.err` |
| Web `vp exec tsc --noEmit` | Passed, exit 0; `web-tsc-stable.log` / `.err` |
| `node scripts/route-graphs.ts --check` | Passed, exit 0, 19 projections; `route-graphs-stable.log` |
| Host `pnpm run build:payload` | Passed, exit 0 on unchanged implementation HEAD; `payload-stable.log` / `.err`. `dist-installed/src-manifest.json` names `184fed12b95a8df2d8c50f9f34352ab0ad9580a0`. |

The inherited MCP failure is `route:ducts.set-view with no mounted view opens only through an explicit command and ignores an older lease`: expected `SA 19`, received `sa 19`. It is unchanged on the base adapter; the unrelated Ducts normalization failure was not changed or suppressed.

PROVEN[deterministic, passing affected assertions and guards in .artifacts/pea-context logs above, 184fed12b95a8df2d8c50f9f34352ab0ad9580a0, 2026-11-07]
FALSIFIED[deterministic MCP suite overall, inherited Ducts SA 19/sa 19 normalization assertion also fails on cb4f12f9]
PROVEN[compile, .artifacts/pea-context/host-tsc-stable.log and web-tsc-stable.log plus route-graphs-stable.log, 184fed12b95a8df2d8c50f9f34352ab0ad9580a0, 2026-11-07]
PROVEN[artifact, .artifacts/pea-context/payload-stable.log and ts/apps/host/dist-installed/src-manifest.json, 184fed12b95a8df2d8c50f9f34352ab0ad9580a0, 2026-11-07]

## Cleanup and limits

All Driver inputs were read-only. Only a disposable copy of product state was used for the surface drive. All preview tabs were closed. Own source Host PID 44984 and earlier own Host PIDs were stopped; their frontend children exited. PID and listener checks found none of the run's Host/frontend processes and no listeners on 52145 or 5174. No Revit or model turn was started, no tree kill or stash was used, and nothing was merged or pushed.

The live green proves retained Family context, authoritative Work/spec access, thread rebinding and the row's explicit Family label. It does not certify native Family execution, PDF support for any parameter, or the two non-Work alias gaps.
