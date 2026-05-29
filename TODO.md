# TODO:

- revist general json intellisense. Through our many refactors, many providers are no longer properly wired up in local schema writes. The issue may extend to to all schema gen too.
- revisit commit 3e3fa88543b9b5435ea87d89efa88bafc2aa1031
    - revisit shared shcedule profile usage. json intellisense is abolished by using this, also has some null-ralted type issues
    - revisit SchedulePreviePanel crash on line 120: `("Order", sg => sg.SortOrder.ToString())`
- customize pea follow-ups:
  - [x] ship Family Foundry/Revit workflow documentation as bundled Pea skills
  - [x] make generated host client/operation metadata first-class for Pea tools and CLI mirrors
  - [x] keep one primary `agent` posture and remove generic plan/subagent clutter from Pea startup
  - [x] strengthen Pea system prompt, Revit docs guidance, and scripting behavior instructions
  - [x] seed Pea-owned MastraCode settings/defaults with OpenAI model pack, yolo, quiet output, theme, goal judge, and OM thresholds
  - [x] document host-reported workspace/settings path guidance instead of hardcoded `Documents/Pe.Tools` assumptions
  - [x] keep `createMastraCode` and `MastraTUI` as the runtime/TUI engines behind a thin Pea-owned policy wrapper
  - [x] add Pea OpenAI Responses item-reference compatibility without broadly disabling prompt caching
  - [x] surface behavior-bearing runtime/cache policy through `pea config defaults`
  - [ ] reevaluate a readonly/oracle posture only after real use proves the UX/context cost is worth it
  - [ ] pursue small public/upstreamable MastraCode TUI policy seams before considering any Pea TUI fork
  - [ ] adapt future Positive Energy auth into MastraCode-compatible env/settings/auth-storage paths before replacing model/auth resolution
  - [ ] reenable/use MastraCode hooks under `.pea` before inventing a Pea hook manager
  - [ ] add more Pea processors for Revit/operator safety, JSON profile validation feedback, or host-operation steering after the OpenAI Responses processor is proven
  - [ ] keep MCP disabled by default until a concrete Pea runtime use case is not covered by public host operations/tools
  - [ ] add liteparse, markitdown, or LlamaParse support if spec-sheet parsing becomes necessary for Family Foundry profile authoring
  - [x] reduce Pea host-operation default output and add bounded Revit projection/budget contracts for schedules, loaded families, bindings, and coverage matrices
  - [x] make high-value Revit host operations example-led, stricter on malformed JSON/filters, and diagnostic-rich for zero-result/truncated outputs
  - [x] add host-operation guidance metadata, visibility gating, request-shape classification, safe defaults, and Pea search ranking around the context -> catalog/browser/resolve -> matrix/detail -> script ladder
  - [ ] add parameter service cache / `parameters.txt` path to host status or a focused host operation if agents keep needing it
  - [x] add bounded `revit.catalog.project-browser` for views/sheets/schedules browser organization, with shared browser filter/provenance contracts
  - [ ] defer separate browser resolver, browser field-options endpoint, browser-specific UI activation, and browser filters on unrelated operations until usage proves them
  - [ ] evaluate dedicated `revit.catalog.views` and `revit.catalog.sheets` only after project-browser/project-index/schedule provenance patterns settle
  - [ ] promote repeated `host_operation_call` patterns into convenience tools only after usage proves they earn context
- `mastracode: pe-tools-ae8e96592dd3` ffmigrator and greater family foundry needs a better mutation model. right now settings are organized by operation, but it should probably be more like "heres the end state i want, ffmigrator please apply this". relevant shortfalls of the current ffmigrator are: 1. provenance of properties group is loose, 2. similar with datatype, 3. parameter end state depends on a lot of variables spread across different models. I want to create a model that optimizes for *both* a maximally declarative *and* minimally verbose authoring layer. good defaults everywhere, and making metadata provenance clear (remember that parameters service allows u to set default metadata values). keeping our current model mostly intact as the imperative compiled layer is probably desirable and maybe unavoidable. *declarative parameter desired-state authoring, compiled into an explicit migration/reconciliation plan*


2026-05-29 11:21:05 [INF] Host bridge dispatch completed: Method=revit.context.summary, RequestId=e0aec7bb1e81439c9ef99eee0629a36d
2026-05-29 11:21:05 [DBG] Bridge request handled: Method=revit.context.summary, RevitExecutionMs=735, RequestBytes=2, ResponseBytes=4022
2026-05-29 11:21:05 [INF] Host bridge writing response frame: Method=revit.context.summary, RequestId=e0aec7bb1e81439c9ef99eee0629a36d, ResponseBytes=4022
2026-05-29 11:21:05 [INF] Host bridge wrote response frame: Method=revit.context.summary, RequestId=e0aec7bb1e81439c9ef99eee0629a36d
2026-05-29 11:21:12 [INF] Host bridge received request: Method=revit.catalog.project-index, RequestId=5cc81c98635b4927b29566c8a3186dc8
2026-05-29 11:21:12 [INF] Host bridge dispatch starting: Method=revit.catalog.project-index, RequestId=5cc81c98635b4927b29566c8a3186dc8
2026-05-29 11:21:13 [DBG] ProjectIndex browser-index collected in 489 ms
2026-05-29 11:21:13 [DBG] ProjectIndex levels collected in 82 ms
2026-05-29 11:21:13 [DBG] ProjectIndex placement-index collected in 249 ms
2026-05-29 11:21:13 [DBG] ProjectIndex views collected in 99 ms
2026-05-29 11:21:13 [DBG] ProjectIndex sheets collected in 58 ms
2026-05-29 11:25:08 [DBG] ProjectIndex schedule-catalog collected in 234362 ms
2026-05-29 11:25:08 [DBG] ProjectIndex loaded-families collected in 679 ms
2026-05-29 11:25:16 [DBG] ProjectIndex instance-counts collected in 7923 ms
2026-05-29 11:25:16 [DBG] ProjectIndex collected in 244052 ms: levels=7, sheets=203, views=365, schedules=14, categories=119, families=25
2026-05-29 11:25:16 [INF] Host bridge dispatch completed: Method=revit.catalog.project-index, RequestId=5cc81c98635b4927b29566c8a3186dc8
2026-05-29 11:25:16 [DBG] Bridge request handled: Method=revit.catalog.project-index, RevitExecutionMs=244238, RequestBytes=427, ResponseBytes=103038
2026-05-29 11:25:16 [INF] Host bridge writing response frame: Method=revit.catalog.project-index, RequestId=5cc81c98635b4927b29566c8a3186dc8, ResponseBytes=103038
2026-05-29 11:25:16 [INF] Host bridge wrote response frame: Method=revit.catalog.project-index, RequestId=5cc81c98635b4927b29566c8a3186dc8
