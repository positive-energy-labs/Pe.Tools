# Route normalization milestone accounting (2026-09-14)

Baseline: `a0e40ad`. Current implementation wave: shared runner, Chat, Takeoffs. Family is an early contract case study; broad route migration follows browser acceptance of the first two routes.

## Accepted ownership rules

- Use a small declaration, a dedicated route controller, and rendering views. Do not create a universal mutable route object.
- Classify state by meaning: target roles, authored Work, authoritative Readings, Page presentation/navigation, and operation lifecycle. Reusable controls retain private interaction mechanics.
- The controller owns dependent transitions such as choosing a document. Components must not sequence cleanup calls.
- Expose selected navigation intents to Pea. Do not expose arbitrary Page field mutation.
- Derive health facts once. Each action declares its requirements; one evaluation feeds UI and agent affordances. Execution validates authoritative conditions.
- A target role can present a continuous session/document/view ladder. The host lamp does not own targeting. Adding another role must not require a second route system.
- Persist fields explicitly using existing storage mechanisms; avoid a generic persistence framework. Review binds to the actual Work revision and evidence.
- Seeds are frozen route moments rendered through the same controllers and views. Their Work stays at `r0`; writes, commands, and external effects are inert. Future interactive examples belong in explicit route-owned choices, not a generic mutable seed API. Select-all means all visible; picker refinements are deferred.

## Measurement contract

At each implementation milestone report scoped additions/deletions, file and public-entity topology, authoritative state owners, duplicate writable facts, rendering-side orchestration, and exact retired/remaining legacy paths. A raw hook count is a search population, not a defect count. Do not claim cyclomatic complexity from LOC or regex counts. Track orchestration paths and independent mutation entrypoints as explicit structural complexity measures.

Acceptance requires real browser buttons for target choice/change, operation success/failure, and reload. Native mutation claims additionally require a matching durable receipt. Source and compile evidence do not close browser acceptance.

## Baseline census

Non-test `.ts`/`.tsx`, measured from the working tree before worker edits. Fable changes already present in Chat/route are included in size but must be excluded from normalization delta attribution.

| Area | Files | Lines | React state/reducer call sites |
|---|---:|---:|---:|
| Shared route | 14 | 4214 | 22 |
| Chat | 11 | 1617 | 5 |
| Workbench | 36 | 5163 | 11 |
| Takeoffs | 32 | 6331 | 6 |
| Family | 30 | 7950 | 1 |
| Families | 12 | 2061 | 1 |
| Settings | 4 | 679 | 8 |
| Instances | 5 | 1060 | 7 |
| Ops | 40 | 6387 | 10 |
| Schedule grid | 6 | 976 | 6 |

Worker baseline: `route/manifest.ts` 102 lines and `route/use-route.ts` 859 lines. Semantic defect denominators are pending the workers' field/caller inventories; none are counted retired yet.

## Wave ownership

- `foundation`, Sol medium: `route/manifest.ts`, `route/use-route.ts`.
- `chat_cutover`, Sol medium: Chat state/contracts and workbench provider; Fable composer files excluded until coordinated.
- `takeoffs_cutover`, Sol medium: `takeoff/`.
- Root: shared contract review, Family case study, dev-loop integration, browser acceptance, scoped commits and measurement.

Fable exclusions at baseline: modified `chat/composer-head.tsx`, `chat/composer.tsx`, `route/inspector.tsx`, `route/situation.tsx`, `LEDGER.md`; untracked `route/flow.tsx`.


## Integration milestone, 2026-09-14

Measured from the implementation at `8e3fb66` against the saved pre-worker working-tree census in `.artifacts/runs/route-normalization-20260914/baseline.json`. The scope is recursive non-test `.ts`/`.tsx` under only the named `apps/web/src` directories. Host, SDK/control-plane, feed, documentation, and test lines are outside this production denominator.

| Area | Baseline files | Current files | File delta | Baseline lines | Current lines | Line delta |
|---|---:|---:|---:|---:|---:|---:|
| Shared route | 14 | 11 | -3 | 4214 | 3400 | -814 |
| Chat | 11 | 11 | 0 | 1617 | 1670 | +53 |
| Workbench | 36 | 36 | 0 | 5163 | 5179 | +16 |
| Takeoffs | 32 | 33 | +1 | 6331 | 6375 | +44 |
| Family | 30 | 30 | 0 | 7950 | 8144 | +194 |
| Families | 12 | 12 | 0 | 2061 | 2096 | +35 |
| Settings | 4 | 4 | 0 | 679 | 708 | +29 |
| Instances | 5 | 5 | 0 | 1060 | 1060 | 0 |
| Ops | 40 | 40 | 0 | 6387 | 6387 | 0 |
| Schedule grid | 6 | 6 | 0 | 976 | 976 | 0 |
| **Total production** | **190** | **188** | **-2** | **36438** | **35995** | **-443** |

This is an exact physical production-source delta, not an authorship total. The baseline already contained concurrent Fable edits in `chat/composer-head.tsx`, `chat/composer.tsx`, `route/inspector.tsx`, `route/situation.tsx`, and untracked `route/flow.tsx`. Their later changes, route normalization, and the current shell consolidation share the measured tree, and no baseline source snapshot exists to split their lines reliably. The -443 therefore remains deliberately unattributed between Fable and normalization. Commit numstat is not comparable because it starts from `a0e40ad`, before those dirty baseline files.

Tests are counted separately under the same directories. The test baseline is the tracked tree at `a0e40ad`; the saved baseline status names no dirty test files. Production and tests together changed by +90 lines, so the production reduction is not presented as the total source change.

| Scope | Baseline files | Current files | File delta | Baseline lines | Current lines | Line delta |
|---|---:|---:|---:|---:|---:|---:|
| Production | 190 | 188 | -2 | 36438 | 35995 | -443 |
| Tests | 28 | 28 | 0 | 3414 | 3947 | +533 |
| **Combined** | **218** | **216** | **-2** | **39852** | **39942** | **+90** |

Topology: Takeoffs `store.ts` becomes the 524-line `controller.ts`; `manifest.ts` is a 32-line declaration beside the 531-line `actions.ts`. Seven dead controller projections and three exact-action aliases are deleted, for ten fewer surface members and 13 fewer production lines. The alternate sentence/standing shell path and its barrel are deleted; Situation is the one remaining route head. The shared global conflict atom/banner is removed. Chat loses its duplicate live draft schema and URL target authority; its controller now owns the one expanded pane. Family removes one empty route Work spec and its subscription and one obsolete settings reader. Its build review, cancellation, and commit now use declared actions, with the review bound to the exact target, settings document, workspace, and file version. Families' capture Reading uses the exact Work owner key; Family and Families select an exact ActionStatus id and read its full receipt detail instead of parsing the stripped status list twice. Seed detail subscriptions are suppressed, Family reuses the handle's inventory Reading, and apply requires current receipt status. Families now also uses that route inventory Reading for current connectivity instead of mounting a second Host-status observer and a manual refresh action/effect. Shared requirement evaluation consumes action needs, Work freshness, and named Reading freshness. Dependent document/view/zone/file/stage transitions own their cleanup. URL owns standalone room/zone/level navigation; embedded panes own that navigation locally.

Legacy retired in this slice: TakeoffStore/useTakeoffStore/TakeoffPageSeed API, AtlasPageState/TakeoffPageMemory/initialMemory, generic selection/atlas/table/targeting setters, dead targeting and recent-directory fields, redundant action wrappers, Takeoffs-only thread query, live project-a saved-reading fallback, separate document/views picker, alternate route shells, Takeoffs' direct RHVAC file-version fetch, Chat manifest draft fallback and undeclared URL target, Chat's duplicate expanded-pane owner, the thread-target revision-zero fallback and caller-only demo guards, global conflict banner, and the Host-local SDK client import fork. Six raw Family/Families semantic calls now use the shared action or Reading owners. A rename alone is not a retirement; these entries name removed authority or behavior.

Deferred product scope recorded at this earlier checkpoint: Families still has seven direct `callHostRpc` sites: two budgeted loaded-family catalog observations, one settings-tree observation, one bounded multi-document profile-library fanout, one user-triggered reverse projection, and two explicit navigation effects. They remain visible because no existing Reading subject owns those observations, and merging the two catalog calls would apply the 5,000-entry budget before the selected category/placement filter. Family still reads its profile options through one direct RPC. The six-call retirement was the exact count in the named Family/Families semantic-action slice; the broader primitive census had not yet landed and is superseded by the RP merge-gate checkpoint below. The deterministic Takeoffs demo corpus remains intentional frozen observation data. Native launch, adopt, partition, sync, and Family/Families operation acceptance remain open.

Proof: the full web `tsc --noEmit` passed at `8e3fb66`. The final Family chain checks passed 19 tests and prove shared ActionHandle refusal retention plus local seeded completion clearing; they do not prove an external failure or native success. Root-owned browser acceptance showed the frozen partition seed at four views and 45 zones and the sync review at Work `r0` against its exact captured RHVAC file version. The retained seed fixture proves seeded Work remains at `r0` after inert writes, reload is inert, actions cannot run external effects, and no live Reading subscription, dirty event, or application-registry node is created. Its seeded file version does not prove a live disk read. A targetless live Takeoffs mount produced no page errors, and the real Chat pane collapsed and expanded under its controller owner. The Chat cancel seed rendered `Operations Demo.rvt` in its isolated data source, kept target/approve/deny disabled, issued zero scope PUTs with zero page errors, and returned to Live through the visible selector. The real Family picker loaded `showcase-spike.family.json`; after the actual Read disk button, route state showed `profile`, `family`, and `inventory` ready, receipts absent, and zero page errors. The head and pane exposed the same `pick a family` refusal while unbound. That is UI/readiness evidence only, with no durable operation receipt; the profile-options RPC and actual native build remain unaccepted. Family/Families receipt and native operation projections remain open. Focused source checks and the deterministic Families test do not accept native behavior despite its `live-lane` filename. In an earlier controlled dev session, PID 17652 launched projectA, bound the exact document, refreshed Takeoffs, initialized its carriers, and an explicit refresh read back zero missing carriers. This does not accept native launch, adopt, partition, or sync in the current checkpoint. The default-only Takeoffs unit was removed after the real targetless browser mount supplied the stronger proof (`f59298a`, -8 test lines).

Runtime caveat: the independent [SDK launch review](./SDK-LAUNCH-REVIEW.md) proved that beta.158 and beta.159 apphost-launched Revits survive a Host restart and die when their owning `vp run` command receives Ctrl+C. Beta.160 enacted the review's correction: SDK commits `40efdee` and `8ab7dc2` restored the compatible launch while retaining honest failure diagnostics. Pe.Tools main (`a183dce`) and route-primitive (`60598aa`) consume identical bytes from the same eleven-package local feeds. The canonical SDK checkout has no configured remote, so the SDK commits and beta.160 release are local-only. Browser acceptance exercised the default `dotnet tool` launch: controlled Revit PID `30400` survived a Host restart and stopped when its owning `vp run dev` received Ctrl+C. The later controlled `route-chat-proof` session remains retained at PID `71428`. The exact causes of the earlier 14:15 and 14:42 exits, and beta.158 default-lane Ctrl+C behavior, remain unproven.

Commits: `19b7851` route runner ownership/failures; `751b163` pinned Host receipt discovery; `5ec7153` main's separate Vite/Host dev command and retiring watcher; `d78f4d4` Chat/Takeoffs ownership, targeting, and seed integration; `a6d57d2` Takeoffs reading health; `11b754a` isolated Chat demos; `b23a512` workspace-package Host watching; `dfbf52a` one route shell; `70d1e98` accurate Revit bridge health; `c1d6e84` Page-dependent Readings; `4d5e152` explicit required-Reading health; `c6430f8` authoritative RHVAC file-version Reading; `a116cbd` SDK beta.159 pins; `7a90d60` dynamic Reading consumers; `c35f449` canonical SDK client relocation; `ba7db21` frozen seed Work; `acf5934` one Chat pane owner; `1f1d10a` dead Takeoffs projections; `8ab1fe3` direct ActionHandle consumers; `f59298a` browser-replaced default unit; `b4abafc` freshness-safe thread targets; `4841e41` Family semantic runner cutover; `cc2e324` normalized seeded target inventories and simplified the Family plan projection; `6d3e7f3` routed Family profile through the file-workspace observation authority; `0bb62b2` preserved provided Reading lifecycle; `73884b1` routed Families through semantic owners; `76637ef` removed the obsolete Family binding adapter; `b410e3d` bound route Readings to their Work owner; `c3b644b` consumed semantic build outcomes; `2fec988` removed empty Family Work; `f442305` read full Families receipts by id; `8ee5562` bound Family apply results to exact receipt detail; `de2736e` passed Work identity to the Takeoffs Reading test; `5004eff` isolated Family route Readings and reused the handle inventory; `003ed6d` removed the obsolete Family settings reader; `0860f3c` reused the route inventory for Families connectivity; `e7f540e` made Family build review and commit declared semantic actions; `59e1965` added the deterministic Family review chain; `8e3fb66` separated refusal retention from seeded completion proof.


## SDK and Chat browser acceptance, 2026-09-14

SDK beta.160 launch is accepted through the real embedded Instances start button and the normal Host/dotnet-tool runner; lifecycle proof and limits are recorded above and in the Host ledger. Both consumer pins and local eleven-package feeds match.

Chat thread `bb0def26-1e72-4e58-aa29-bf023a45f018` was exercised through Chrome buttons at `http://127.0.0.1:5173`: unbound send; composer session/document choice; clear target and unbound send; rebind; native read; reload. Clear admitted null target at revision 2. Rebind admitted revision 3, bridge session `session-6457a750dbe84075`, open ID `9e13695819dd43cd8f3fab784c7966bf`. Discovery returned catalog ok; `pe_read op:revit.context.summary` returned project-a-review from SDK session `route-chat-proof`, matching the admitted identity through topology. The final response cited the native result; reload retained target and transcript with zero page errors. Proof session: controlled dev, PID 71428.

Browser acceptance exposed and closed two discovery defects: `31b4cc3` supplies the admitted session to pe_find; `4fe3c76` preserves that raw bridge selector at the HTTP catalog boundary. Existing focused suites passed 7/7 and 11/11 respectively. `d43c206` fixes render-time Reading notification (15 focused checks and browser new-thread proof); `b2ddd77` removes the Instances manifest barrel cycle (real picker/launch proof). No new state owner or compatibility layer was added. SDK launch correction removed 273 net lines; these four product fixes add 13 net production lines across four existing files. Test additions remain separate from production accounting.

Limits: the successful native-read prompt named its capability; broad natural-language discovery quality is not accepted. The earlier interrupted turn and cancelled discovery spiral are retained, not counted as success. Takeoffs native adopt/partition/sync and Family native build/apply with matching receipts remain product acceptance debt outside the RP merge gates; frozen seeds and compile checks do not close them.

## Close checkpoint (2026-09-15)

The real browser bound the controlled `route-chat-proof` dev session and project-a document through the visible target picker. Takeoffs adoption succeeded as action `41622a81-922c-4cdb-8f79-6ea808dfed84`; partition succeeded as `a6784b0d-9e41-4469-9b1a-46897078eddf`. Repeated exact-target `/actions` reads returned the same durable receipts. The resulting native reading has one adopted zone, zero materialized rooms, and 16 held residues marked `no-floor` / `remeasure-required`, so sync is not admissible on this model.

Family build now admits a project document as its execution context, while family-only capture/apply retain their stricter target need. The browser review/commit reached `family.build` action `f5b9f390-70aa-44c6-8ca6-2ff868e55ab1` and exposed the shared placement-token mismatch. The contract fix accepts the existing author labels and the deterministic alias test passes. Exact-ID recovery found a terminal failed SDK receipt, but beta.160 omitted a typed pre-dispatch outcome; the action journal therefore correctly retains `unknown` and blocks replacement IDs. Build/open/rebind/apply convergence remains unaccepted pending an explicit human decision to retire that uncertainty.

## RP merge-gate checkpoint (2026-09-15)

Stable code checkpoint `271c7f6` closes the primitive-level compatibility system without claiming product completion. `Situation`, `FlowMatrix`, and the Chat composer head now project the route handle's Target, Work, Readings, Page, actions, outcomes, and log; they contain no demo selector, seed thread, fabricated caller, aggregate readiness owner, or fallback target/status authority. Frozen seeds remain read-only proof inputs outside the production head.

Every production consumer now mounts a route manifest through `useRoute`. The deleted `workbench/route-state.tsx` compatibility owner, generic raw-JSON pane writer, generic Chat Work connector, direct `docAtom`/`docWriter` consumers, obsolete target hosts, retired primitive aliases, and alternate Parameter Links action ports have zero production callers. The low-level Work atom and writer are private to `useRoute`; the repo guard forbids reimporting the deleted compatibility module. Canonical Work writes preserve explicit compare-and-swap revisions, serialize same-tick authored patches, expose currentness and unknown-outcome lifecycle state, and refuse frozen writes.

Current topology is one route controller (`route/use-route.ts`), one declaration contract (`route/manifest.ts`), one production head (`route/situation.tsx`), one read-only flow projection (`route/flow.tsx`), and route-owned manifests for Chat, Instances, Settings, Family, Families, Takeoffs, Parameter Links, Schedule Grid, and Ops. Parameter Links page and Chat controls share manifest actions for refresh, preview, and apply. Instances, Settings file Work, Family's settings Work, Schedule Grid, and Chat reviewers no longer retain a second primitive owner.

Focused source checks and 13 consolidated route/guard tests pass at this checkpoint. Schedule Grid's pre-read and refreshing seams pass; its shared host-backed fixture stalled during setup before later assertions, so that fixture lane remains incomplete rather than reported as product failure or success. No new Revit, browser, SDK, RHVAC, or Family native acceptance was attempted for these merge gates.

Product debt, not RP blockers: project-a still has no materializable rooms for Takeoffs sync acceptance; Family native build/open/rebind/apply remains unaccepted behind the original unknown receipt; the existing Family/Families observation and navigation RPC ports remain feature-specific work. Merge preparation found RP and local main substantially diverged with projected conflicts in Host/dev-loop, shared product transport, Family migrators, targeting deletions, and docs. Resolve those after squash/Fable review in an isolated integration checkout, preserve beta.160 pins and main's foreign `.claude/launch.json`, and do not merge or push main from this checkpoint.
