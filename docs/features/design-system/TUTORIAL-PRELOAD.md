# Tutorial before loading

The selected Foldout manual uses one `HelpWorld` for public loading and mounted Tutorial. The user rejected prose as a substitute for the map, chose B, and requested complete anatomy, actual folds and live title rails. F remains separate upcoming work in [LEDGER.md](LEDGER.md).

## Authority and flow

| Authority | Before loading | Mounted workspace |
| --- | --- | --- |
| [DUCTS_LAYOUT](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | `declaredTeaching` projects all seven panes, nested splits and reference geometry | [TeachingLayoutView](../../../ts/packages/kit/src/components/lang/teaching-layout.tsx) creates every structural Pane and PaneSplit; [EScreen](../../../ts/apps/web/src/ducts/proto/e/screen.tsx) supplies leaf content and furniture |
| [PaneSplit](../../../ts/packages/kit/src/components/lang/pane-resize.tsx) | No current fold is asserted | Existing split machine owns sizing and folding; Tutorial observes resolved rails and geometry |
| [Teaching registry](../../../ts/packages/kit/src/components/lang/use-teach.ts) | Descriptions passed directly, never fake registrations | Scoped inventory joins visible controls and measurements; hidden controls retain explicit described fallback |
| [teachingTitle](../../../ts/packages/kit/src/components/lang/teach-measure.ts) | Declared label | Mounted header with separated breadcrumbs; list accessible name then declaration are fallbacks |
| [STAGE_ACTIONS](../../../ts/apps/web/src/scene/stage-teaching.ts), [list actions/search](../../../ts/packages/kit/src/components/lang/list-teaching.ts), [picture declarations](../../../ts/apps/web/src/ducts/proto/e/teaching.ts) | Shared control descriptions without runtime flags | Actual controls consume those declarations and publish current facts |
| [SHELL_REGIONS](../../../ts/apps/web/src/route/teaching.ts) | Generic public map in the static SPA index | Hydration selects route declarations, then mounted measurements replace reference geometry |

[HelpWorld](../../../ts/apps/web/src/route/help.tsx) renders [PageMap](../../../ts/packages/kit/src/components/lang/page-map.tsx), the full pane index, shared controls and selected details. Guide selection never operates the workspace.

The composition includes Systems, System tree, Inputs, All-systems rules, This system's rules, Picture and Rulings. Both sidebar choices share actual selection state. Availability is separate from visibility. Folded descendants remain inspectable and point to one covering rail. Reopening an ancestor preserves a descendant's own fold state.

Expanded map panes have top title rails. Folded panes retain the actual rail orientation. Miniature title bands use row height and small chrome type. Physical pane headers use control-plus-gutter height; controls may wrap rather than clip. Route rails retain their separate height.

## Boundaries

- One SPA index serves every path, so the pre-JavaScript map is generic. Hydration selects Ducts reference anatomy. No document name, selection or availability is asserted before admission.
- Local or paired admission still gates protected content. Reference maps remain during connection, pairing, snapshot acquisition and pricing.
- Reference geometry expands declared anatomy at a reference viewport. Mounted Tutorial respects actual folds, widths, availability and live titles. It does not restore reference rectangles over missing mounted panes.
- Route and instance identity isolate retained compositions. Hidden controls remain marked as declarations even when geometry is measured.
- No hidden workspace/WebGL mount, second fold state machine, cache, cross-tab store or extra SSR runtime was added. The separate caching spikes remain unlanded.

## Proof and repeat

Current evidence lives in `.artifacts/runs/tutorial-foldout-20261026/`. Earlier source-loading evidence remains in `.artifacts/runs/browser-20261024-tutorial-preload/`; its old four-region expectations do not certify this complete composition.

- Production build: `complete-build.log`, exit 0 at `52335b5c`.
- Built browser: `structural-browser/evidence.json` and `complete-browser.log`, 13 cases and 92 assertions, clean owned-browser shutdown, `52335b5c`, 2026-10-26 03:57:52 UTC. Measured map rectangles match actual pane/rail rectangles within 0.02px.
- Full workspace gate: `final-verify.log`, exit 0 at `f3f72b95`, 2026-10-26 04:52:48 UTC. Formatting, lint/types, knip, kit build, every package suite, 111 guards, required product selection browser and R24 compile all pass. This includes 616 web, 548 host and 17 browser-package tests; R24 reports zero errors with existing warnings.
- The first complete gate passed every package suite and 111 guards, then failed the required browser case during cold source boot. The trace spent most of its initial 20s assertion budget compiling client modules and reached pricing at the deadline. `52335b5c` gives startup a separate 60s readiness phase and records its duration; selection/history retain their 20s limits. The isolated rerun passed all six checkpoints with 10,667ms source startup (`selection-startup-diagnostic-correct-api.log`).
- The combined-tree rerun passed every package suite, then found an obsolete I2 guard after the concurrent damage-batching refactor. `3cf4f16f` keeps the shared depth bias at its new rendered owner and guards that owner, while documenting the invisible picking proxy. All four material offsets are asserted; changing units from -4 to 0 fails the real material test (`depth-bias-mutation.log`). The restored seven material tests and 88 census cases pass (`depth-materials.log`, `depth-guard.log`). Product selection and R24 compile also pass independently (`tail-selection.log`, `tail-r24.log`).
- A later combined-tree run found two host test assumptions. `f3f72b95` awaits the existing acquired lifecycle handle before reading the terminal context; a service file alone precedes that context. It also recognizes the browser guide as a new host runtime dependency. Three focused assertions pass in `host-readiness-final.log`; no runtime behavior changed.

| Browser case | Behavior driven |
| --- | --- |
| `public-before-javascript.png` | Generic map and title rails with scripts disabled |
| `ducts-reference.png`, `reference-inputs.png` | Seven panes during held admission; only admission requested; Inputs selectable |
| `pairing.png`, `pricing.png` | Protected workspace absent during pairing and worker hold; complete guide retained |
| `no-system.png`, `unavailable-inputs.png` | Seven measured identities; Inputs states its real prerequisite |
| `inputs-own-rail.png`, `inputs-open.png` | Actual Inputs expansion; guide follows geometry and live titles |
| `inputs-in-folded-parent.png` | Linked choices change together; Inputs remains selectable beneath a folded parent |
| `whole-sidebar-folded.png` | Actual resize folds the ancestor; descendants share one rail; reopening preserves Inputs state |
| `rulings-requested.png` | At measured narrow workspace width, requesting Rulings yields the sidebar under existing priority policy |
| `narrow-reference.png` | Selected Inputs detail remains usable at 390px without page overflow |

Each captured case checks console warnings/errors, visible geometry, compact map title bands and physical headers unless controls wrap. The harness serves production assets, admits synthetic environment state and holds actual pricing-worker submission. The existing `?demo=navigation` fixture disables native actions. Other host APIs return harness errors; nothing forwards to Revit.

From `ts`: `pnpm verify`. From `ts/apps/web`: `vp build`. From the main checkout root, run `node .artifacts/runs/tutorial-foldout-20261026/serve.mjs <built-checkout> 5216`, then `node .artifacts/runs/tutorial-foldout-20261026/structural-browser-proof.mjs <built-checkout>`. Stop the owned server afterward.

PROVEN[artifact/browser, production SPA in owned synthetic fixture harness, `52335b5c`, 2026-10-26 03:57:52 UTC]. UNPROVEN[delayed native snapshot, installed/Revit behavior, real-model speed and docked Pea Tutorial entry; standalone artifact harness does not supply the docked workbench]. Route ownership remains deterministically covered.

PROVEN[deterministic/browser/compile, complete serialized workspace `pnpm verify` in clean checkout, `f3f72b95`, 2026-10-26 04:52:48 UTC]. Explicit top-level browser and product selection receipts are preserved under `workspace-gate/`; runtime homes and profiles are excluded. All owned fixture hosts and browsers are stopped. The existing main-checkout source dev server is retained for review; no installed host or Revit session was operated.

## Change depth

The complete-composition correction and compact-title follow-ups (`03666ed8..651e6327`) change 19 files, +1,375/-407 lines. Tests and guards account for +512/-10. Production code accounts for +859/-396 across 13 files; the remaining two files capture decisions.

| Change | Shim assessment |
| --- | --- |
| Complete composition and leaf-only content API | Structural correction; removes opaque nested layout and branch replacement |
| Inventory plus actual split observations | Direct projection of existing owners; no duplicated fold state |
| Generic/reference loading facts | Deliberate public approximation until actual state exists |
| Foldout and compact title rails | Shared kit rendering and density tokens |
| Live title reading | Reads physical furniture; preserves breadcrumb boundaries and stable identity |
| Selection browser startup phase | Explicit source readiness before behavior checks; no interaction deadline was relaxed |
| I2 guard migration after batching | Same rendered depth values at the new owner, with material assertions; no waiver |
| Host readiness and watcher tests | Use the existing readiness signal and current dependency graph; no runtime workaround |

Compatibility shims added: zero. Deeper work would bring settled routes onto complete compositions. F can add task-oriented explanation over those facts without inventing another layout owner.
