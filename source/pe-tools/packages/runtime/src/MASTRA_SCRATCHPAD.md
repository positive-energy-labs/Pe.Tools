# Mastra internals scratchpad: Gateway, router, OM

Short-term research note. Keep this about Mastra internals. Very densely worded. Pe.Tools notes appear only where Mastra evidence supports or blocks a Pe.Tools approach.

## Evidence index

- **M1 exports**: `../mastra/packages/core/src/llm/index.ts:79-93,161-181` exports `ModelRouterLanguageModel`, `defaultGateways`, `GatewayRegistry`, `PROVIDER_REGISTRY`, `modelSupportsAttachments`, `MastraGateway`, gateway types, `GATEWAY_AUTH_HEADER`, `resolveModelAuth`.
- **M2 gateway class**: `../mastra/packages/core/src/llm/model/gateways/mastra.ts:9-124` defines `MastraGatewayConfig`, enablement, base URL normalization, provider config, API-key resolution, OAuth/custom-fetch branches.
- **M3 router**: `../mastra/packages/core/src/llm/model/router.ts:107-111,143-200,341-383,510-563` defines default gateways, custom-gateway merge, gateway selection/parsing, auth resolution order, custom URL/openai-compatible branch.
- **M4 gateway interface/types**: `../mastra/packages/core/src/llm/model/gateways/base.ts:44-126` defines `GatewayAuthRequest`, `GatewayAuthResult`, `MastraModelGatewayInterface`, `ProviderConfig`, `GatewayLanguageModel`.
- **M5 gateway helpers**: `../mastra/packages/core/src/llm/model/gateways/index.ts:22-67` defines `getGatewayId`, `shouldEnableGateway`, `findGatewayForModel` prefix-vs-`models.dev` behavior.
- **M6 header constant**: `../mastra/packages/core/src/llm/model/gateways/constants.ts:25-26` exports `GATEWAY_AUTH_HEADER = "X-Memory-Gateway-Authorization"`.
- **M7 MastraCode model resolver**: `../mastra/mastracode/src/agents/model.ts:174-346,367-409` shows custom `mastracode` gateway, provider OAuth/key fallbacks, Gateway delegation, dynamic current-model resolution.
- **M8 MastraCode OM**: `../mastra/mastracode/src/agents/memory.ts:79-140` shows dynamic `Memory` factory, request-context state reads, OM thresholds/models/scope, cache key, vector/embedder behavior.
- **M9 MastraCode state schema**: `../mastra/mastracode/src/schema.ts:66-96` declares `observerModelId`, `reflectorModelId`, `observationThreshold`, `reflectionThreshold`, `observeAttachments`, `omScope`, `thinkingLevel`.
- **M10 MastraCode dynamic instructions**: `../mastra/mastracode/src/agents/instructions.ts:8-30`, `../mastra/mastracode/src/agents/prompts/index.ts:45-108` build the run prompt from harness state, task list, static instruction files, model prompt, and mode prompt.
- **M11 prepare-memory step**: `../mastra/packages/core/src/agent/workflows/prepare-stream/prepare-memory-step.ts:84-126,189-217` creates the receiving `MessageList`, adds system/context/input messages, sets memory context, runs input processors, then parks the message list on run scope.
- **M12 instruction/processor orchestration**: `../mastra/packages/core/src/agent/agent.ts:1276-1323,1871-1898` resolves function instructions and orders input processors as memory, workspace, skills, channel, browser, configured.
- **M13 AgentsMDInjector**: `../mastra/packages/core/src/processors/tool-result-reminder.ts:229-292,314-379` finds instruction files from completed tool-call path args and emits a reactive `system-reminder` signal without directly mutating the returned `MessageList`.
- **M14 tool payload path**: `../mastra/packages/core/src/agent/workflows/prepare-stream/prepare-tools-step.ts:45-79`, `../mastra/packages/core/src/agent/workflows/prepare-stream/map-results-step.ts:62-80,223-232`, `../mastra/packages/core/src/agent/workflows/prepare-stream/stream-step.ts:81-130` convert tools, park them on run scope, map them into loop options, and pass them to `llm.stream` separately from message text.
- **M15 MockMemory**: `../mastra/packages/core/src/memory/mock.ts:75-118,135-180,238-347,386-451` shows test memory owns storage, requires memory domain, filters system messages/reminders, exposes working-memory tool only when configured, and delegates clone/delete/update to storage.
- **M16 composite storage**: `../mastra/packages/core/src/storage/base.ts:27-67,124-197,283-337,342-469` defines storage domains, editor domains, domain/default/editor priority, Mastra registration cascade, parent-first init, and leftover-domain init.
- **M17 Mastra storage defaults**: `../mastra/packages/core/src/mastra/index.ts:1038-1072,3488-3492` defaults missing app storage to in-memory, patches workflows/backgroundTasks when absent, and wraps/registers storage on setStorage.
- **M18 Agent memory storage injection**: `../mastra/packages/core/src/agent/agent.ts:1586-1623` resolves function memory, registers Mastra, and injects Mastra storage only when memory does not have own storage.
- **M19 MastraCode storage runtime**: `../mastra/mastracode/src/index.ts:303-344,654-701,857-863` creates app storage, overrides harness/observability domains, reconstructs sessions from memory threads, passes storage/memory into Harness, and restores OM thread state.
- **M20 MastraCode storage paths/factory**: `../mastra/mastracode/src/utils/project.ts:181-225,290-334`, `../mastra/mastracode/src/utils/storage-factory.ts:29-57,119-142` resolves app-data LibSQL defaults, env/settings/PG overrides, fallback LibSQL, and separate vector DB.
- **D1 Gateway models docs**: `https://gateway.mastra.ai/docs/models` documents OpenRouter-backed default routing, direct provider bindings, BYOK pass-through, provider resolution order.
- **D2 Gateway features docs**: `https://gateway.mastra.ai/docs/features` documents OM headers, memory config, model selection, BYOK, endpoints, streaming, tools.
- **D3 Gateway limits docs**: `https://gateway.mastra.ai/docs/limits` documents `msk_` keys, 401s, rate limits, rate-limit headers, pagination caps.

## Public Mastra surface to prefer over local copies

- Use `ModelRouterLanguageModel` as primary model-routing primitive; it is exported directly from `@mastra/core/llm`, so local router/parsing clones should be suspect. Evidence: M1, M3.
- Use `MastraGateway` rather than hand-rolled Gateway URL/client code; it already knows Gateway base URL normalization, API-key env fallback, OpenRouter-compatible provider construction, and OAuth/custom-fetch header split. Evidence: M2.
- Use gateway interfaces/types when custom behavior is unavoidable: `MastraModelGatewayInterface`, `GatewayAuthRequest`, `GatewayAuthResult`, `GatewayLanguageModel`, `ProviderConfig`. Evidence: M1, M4.
- Use exported provider/model metadata before building tables: `GatewayRegistry`, `PROVIDER_REGISTRY`, `parseModelString`, `getProviderConfig`, `modelSupportsAttachments`. Evidence: M1.
- Use `GATEWAY_AUTH_HEADER`, not a string literal, when provider OAuth owns `Authorization` and Gateway auth must move to `X-Memory-Gateway-Authorization`. Evidence: M1, M6.

## Mastra Gateway source behavior

- `MastraGatewayConfig` accepts `{ apiKey?, baseUrl?, customFetch? }`; no extra Pe.Tools wrapper needed for those basics. Evidence: M2 `mastra.ts:9-13`.
- Gateway enables only with config `apiKey` or `MASTRA_GATEWAY_API_KEY`; missing key means `fetchProviders()` returns `{}` and `getApiKey()` throws `MASTRA_GATEWAY_NO_API_KEY`. Evidence: M2 `mastra.ts:28-35,58-69`.
- Gateway base URL defaults to `https://gateway-api.mastra.ai`, strips trailing `/` and `/v1`, then `buildUrl()` returns `<base>/v1`. Evidence: M2 `mastra.ts:23-25,54-55`.
- Gateway provider id is `mastra`; display name in source is currently `Memory Gateway`. Evidence: M2 `mastra.ts:15-18,40-48`.
- Gateway provider model list currently mirrors OpenRouter registry models from `PROVIDER_REGISTRY['openrouter']`. Evidence: M2 `mastra.ts:37-47`.
- No-`customFetch` path uses `createOpenRouter({ apiKey, baseURL })` and sends Gateway key as ordinary `Authorization`. Evidence: M2 `mastra.ts:113-121`.
- `customFetch` + Anthropic path uses native `createAnthropic`, because Anthropic Messages is not OpenAI chat completions; Gateway key goes in `GATEWAY_AUTH_HEADER`, custom fetch owns provider auth. Evidence: M2 `mastra.ts:85-97`.
- `customFetch` + non-Anthropic path uses OpenRouter-compatible chat; Gateway key goes in `GATEWAY_AUTH_HEADER`, custom fetch owns `Authorization`. Evidence: M2 `mastra.ts:99-110`, M6.
- Conclusion: Gateway can participate in OAuth flows, but it does not erase provider-specific OAuth fetch logic; someone still owns `customFetch`. Evidence: M2, M7.

## Model router behavior

- `defaultGateways = [new NetlifyGateway(), new MastraGateway(), new ModelsDevGateway(...)]`; Mastra Gateway is already in core default routing. Evidence: M3 `router.ts:107-111`.
- `ModelRouterLanguageModel` accepts string/router config, normalizes to `id`, selects a gateway once, and exposes `provider`, `modelId`, `gatewayId`. Evidence: M3 `router.ts:143-200`.
- Custom gateways can be passed to `new ModelRouterLanguageModel(config, customGateways)`; custom gateways win over defaults by gateway id. Evidence: M3 `router.ts:183-190`.
- Gateway-prefixed model ids look like `mastra/provider/model`; `models.dev` is special and does not use a prefix. Evidence: M3 `router.ts:191-200`, M5 `index.ts:41-58`.
- Auth resolution order: explicit URL => explicit API key => `gateway.resolveAuth(request)` => `gateway.getApiKey(routerId)`. Evidence: M3 `router.ts:341-383`.
- `GatewayAuthResult.bearerToken` is converted into `Authorization: Bearer <token>` before model resolution. Evidence: M3 `router.ts:360-367`, M4 `base.ts:51-56`.
- Custom URL branch bypasses Gateway provider registry and uses `createOpenAICompatible({ baseURL: config.url, apiKey, headers })`. Evidence: M3 `router.ts:554-563`.
- Useful custom-gateway minimum: implement `id`, `name`, `fetchProviders`, `buildUrl`, `getApiKey`, `resolveLanguageModel`; add `resolveAuth` only when auth source is dynamic. Evidence: M4.

## Gateway docs behavior

- Gateway docs: default routing is OpenRouter-backed; any OpenRouter model id should work with Gateway auth. Evidence: D1.
- Direct provider bindings and BYOK pass-through exist; provider resolution order is BYOK override, model prefix binding, API-key binding, project binding, OpenRouter fallback. Evidence: D1.
- Gateway keys use `msk_`; invalid/missing key returns 401. Evidence: D3.
- LLM proxy rate limits documented: global 5000/60s, LLM proxy 2000/60s, burst 400/10s; memory read/write separately limited. Evidence: D3.
- Responses include rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Scope`, `Retry-After` on 429. Evidence: D3.
- Gateway features include OpenAI Chat Completions, Anthropic Messages, OpenAI Responses, streaming, BYOK, Gateway tools/web search. Evidence: D2.
- Model switching is intended to be just changing the request `model` field. Evidence: D2.

## Gateway OM behavior and constraints

- Gateway OM activates from proxy requests when both `x-thread-id` and `x-resource-id` are present. Evidence: D2.
- Docs say `x-thread-id` without `x-resource-id` returns 400; both headers are required to activate OM. Evidence: D2.
- Gateway OM automatically extracts/stores observations and injects relevant context on future requests; app code does not manage memory directly. Evidence: D2.
- Gateway OM config docs expose `observationTokens` default 30000 and `reflectionTokens` default 40000. Evidence: D2.
- Critical limitation: docs say observer/reflection models are not configurable; Gateway selects them. Evidence: D2.
- Therefore Gateway-hosted OM can reduce memory code only if product accepts Gateway-selected observer/reflector models. If Pe.Tools must control OM models, retain SDK/local OM or request/add Gateway capability. Evidence: D2; Pe.Tools captured blocker at `docs/context/pea-beta-local-auth-architecture.md:115`.
- If using Gateway only for routing, omit the complete `x-thread-id` + `x-resource-id` pair to avoid unintentionally enabling Gateway OM. Evidence: D2.
- If local SDK OM and Gateway OM are both active, expect double observation/injection risk; choose one memory authority per call path. Evidence: D2, M8.

## MastraCode internals as prior art, not direct product shape

- MastraCode wraps all model ids through a custom gateway id `mastracode`, then passes that gateway to `ModelRouterLanguageModel`; this is a pattern for centralizing auth/model quirks behind Mastra’s router. Evidence: M7 `model.ts:174-190,389-392`.
- MastraCode custom gateway delegates to `MastraGateway` when `routeThroughMastraGateway` is true, otherwise falls back to local provider auth/custom providers. Evidence: M7 `model.ts:187-217,334-341`.
- MastraCode handles provider-specific branches for Anthropic OAuth/API key, OpenAI Codex OAuth/API key, GitHub Copilot, Moonshot, and custom OpenAI-compatible providers. Evidence: M7 `model.ts:218-332`.
- MastraCode OpenAI Codex path remaps some OpenAI model ids to `*-codex` variants and applies thinking-level middleware. Evidence: M7 `model.ts:38-102,290-315,320-325`.
- MastraCode dynamic model reads `currentModelId` and `thinkingLevel` from harness request context, then calls `resolveModel`. Evidence: M7 `model.ts:399-409`.
- MastraCode local OM reads state from request context, so observer/reflector models and thresholds can change per harness state without rebuilding app globals. Evidence: M8 `memory.ts:79-90,115-131`, M9.
- MastraCode local OM caches `Memory` by thresholds/scope/caveman/attachment config; cache key intentionally excludes model ids because model functions read current state at generation time. Evidence: M8 `memory.ts:84-93,118-130`.
- MastraCode local OM disables async buffering for `resource` scope. Evidence: M8 `memory.ts:95-117,126-128`.
- MastraCode local OM uses `fastembed.small` only when vector storage exists. Evidence: M8 `memory.ts:103-107`.
- MastraCode local OM has explicit instruction to not observe dynamic AGENTS.md reminders. Evidence: M8 `memory.ts:47-49,98-100`.
- MastraCode durable conversation state is the storage `memory` domain; harness sessions can be reconstructed from threads, while harness storage itself can stay overridden/in-memory. Evidence: M19.
- MastraCode local storage default is app-data LibSQL plus separate vector DB, with env/settings/PG escape hatches. Evidence: M20.

## Mastra storage/memory primitives

- `MockMemory` is useful test prior art, not product runtime storage: it sets own storage, so app-level Mastra storage will not be injected into it. Evidence: M15, M18.
- Real durable runtime memory should use `Memory` over a storage `memory` domain; thread/message/resource/OM authority lives there. Evidence: M16, M19.
- `MastraCompositeStore` is the right composition seam for Pe runtime profiles: `domains` overrides beat `editor`, `editor` beats `default`, and parent store init stays owned by the parent adapter. Evidence: M16.
- Editor/skill/config storage can use the `editor` or explicit `skills` domain without forcing memory/workflow storage into the same backend. Evidence: M16.
- Missing app storage silently becomes in-memory in core, and missing workflow/background-task domains are patched with in-memory infrastructure. Product runtimes should validate intended durability explicitly. Evidence: M17.

## Pe.Tools implications justified by Mastra evidence

- Strong deletion target: local copies of provider registries, gateway id parsing, Gateway URL building, gateway auth result shapes, and attachment capability maps. Mastra exports cover these. Evidence: M1-M6.
- Do not assume Gateway removes all auth code. Gateway removes ordinary provider-key routing work, but OAuth passthrough still needs provider-specific `customFetch` logic. Evidence: M2, M7.
- Do not replace Pe.Tools-controlled OM with Gateway OM if observer/reflector model control is required. Gateway docs currently block that. Evidence: D2; Pe.Tools note `docs/context/pea-beta-local-auth-architecture.md:115`.
- Prefer small adapters over forks: current spike helper `source/pe-tools/packages/runtime/src/models/mastra-gateway.ts` should stay a thin `MastraGateway` + `ModelRouterLanguageModel` wrapper, not a router clone. Evidence: M1-M3.
- If a Pe.Tools custom gateway becomes necessary, model it on `MastraModelGatewayInterface` and delegate to `MastraGateway` where possible; use MastraCode only as prior art for OAuth edge cases, not as a full template. Evidence: M4, M7.
- `@pe/runtime` should define storage/auth/memory/skill profile seams; Pea and peco should select profiles. Do not bury LibSQL paths, Gateway auth, OM instructions, or skill roots in transport sessions. Evidence: M16-M20.
- peco should preserve MastraCode-compatible thread storage semantics if it wants shared Peco history: durable `memory` domain plus session reconstruction, not `MockMemory` or a separate Pea product DB. Evidence: M15, M18-M20.
- Pea should use its own product local storage root and resource identity; Gateway model auth can be shared conceptually, but local LibSQL remains the safer canonical thread store unless Gateway OM is explicitly chosen as memory authority. Evidence: D2, M16-M20.
- Skills should be treated as a runtime profile backed by bundled definitions and/or storage `skills`/`editor` domains; keep peco repo skills separate from Pea operator skills. Evidence: M16.
- OM instruction customization should stay on local SDK `Memory` when Pe.Tools needs observer/reflector model and instruction control; Gateway routing can still serve the LLM calls. Evidence: D2, M8-M9.

## Mastra agent context assembly / receiving-model perspective

| Surface                                                    | Modifies system prompt?                                                                                                                    | Modifies conversation/model messages?                                                                                               | Prompt-cache implication                                                                                                                       | Agent scope                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Agent.instructions` / MastraCode `getDynamicInstructions` | Yes: resolved instructions become the base system message.                                                                                 | No durable history by itself; it is run-assembled request context.                                                                  | Good only when stable. MastraCode task-list injection near the top is cache-hostile because task churn changes the prefix before long history. | Main agent. Evidence: M10-M12.                                                                                                      |
| `prepare-memory-step`                                      | Yes: adds instructions, MCP guidance, optional context/system messages.                                                                    | Yes: constructs the `MessageList` the model receives; with Memory, thread/resource context is also set before processors run.       | Base instructions can cache; later MCP/context/memory inserts can still change the model input.                                                | Main-agent prepare-stream step, not a separate memory agent. Evidence: M11.                                                         |
| Memory input processors                                    | Processor-dependent; memory processors run before workspace/skills/channel/browser/configured processors.                                  | Yes: they enrich the main agent input with history/recall/working-memory shape before the LLM call.                                 | Dynamic recall before stable chat can reduce cache reuse.                                                                                      | Main agent receives memory-enriched input; OM observer/reflector calls, when enabled, are separate memory internals. Evidence: M12. |
| `AgentsMDInjector`                                         | Not by returning a new system message; it emits a reactive `system-reminder` signal when tool-path activity discovers an instruction file. | Yes-ish: the reminder becomes signal/reminder context for subsequent model input; the processor returns the original `MessageList`. | Better than loading every nearby instruction in the prefix, but emitted reminders still change later inputs.                                   | Main-agent input processor. Evidence: M13.                                                                                          |
| Tool descriptions/schemas                                  | No: not prompt text.                                                                                                                       | No: passed as `tools` in loop options/provider payload, separate from the message list.                                             | Text prefix cache is not directly affected by tool descriptions, though provider-side tool payload caching may vary.                           | Main agent tool interface. Evidence: M14.                                                                                           |

- Mental model: `prepare-memory-step` is a model-input assembler despite its name; `AgentsMDInjector` is middleware that can add reactive instruction reminders; neither is the user-facing “memory agent.” Evidence: M11-M13.
- The receiving model does not know provenance unless the content itself names it. `system`, `system-reminder`, memory recall, tool schemas, and ordinary chat arrive through different code paths but are flattened into model-call inputs. Evidence: M11-M14.

## Mastra tool visibility / provenance implications

- `Agent.listTools()` returns only statically/dynamically assigned agent tools; browser tools are explicitly deferred to execution-time `convertTools()`. Evidence: `../mastra/packages/core/src/agent/agent.ts:2201-2240`.
- Runtime execution tool inventory is merged in `convertTools()` from assigned, memory, toolset, client, agent, workflow, workspace, skill, channel, browser, and input-processor tools. Evidence: `../mastra/packages/core/src/agent/agent.ts:5273-5458`.
- Workspace tools are generated by `createWorkspaceTools(workspace, configContext)` and are filtered/renamed by workspace tool config, not by a fixed MastraCode list. Evidence: `../mastra/packages/core/src/workspace/tools/tools.ts:128-172,376-472`.
- Core workspace tool ids use `mastra_workspace_*`; MastraCode renames them to LLM-facing names such as `view`, `find_files`, `search_content`, `execute_command`, and `lsp_inspect`. Evidence: `../mastra/packages/core/src/workspace/constants/index.ts:1-49`, `../mastra/mastracode/src/tool-names.ts:47-60`.
- Workspace tool creation is capability-gated by filesystem/search/sandbox/LSP and resolves dynamic filesystem/sandbox providers at execute time. Evidence: `../mastra/packages/core/src/workspace/tools/tools.ts:187-220,475-555`.
- MastraCode excludes tools before model exposure in three places: `disabledTools` removes dynamic tools, permission `tools[name] === "deny"` deletes dynamic/harness tools, and subagent `allowedWorkspaceTools` hides workspace tools via `prepareStep`. Evidence: `../mastra/mastracode/src/agents/tools.ts:143-158`, `../mastra/packages/core/src/harness/harness.ts:4030-4048`, `../mastra/packages/core/src/harness/tools.ts:1045-1068`.
- Mastra Harness tool events expose `toolCallId`, `toolName`, args/result/status, and provider metadata on result, but not a canonical origin/kind/provenance field. Evidence: `../mastra/packages/core/src/harness/types.ts:730-763`, `../mastra/packages/core/src/harness/harness.ts:2625-2688`.
- Therefore Pe protocol adapters should not infer tool kind from hard-coded protocol sets. Prefer a Pe-owned runtime tool registry/projection context seeded by app runtime factory/tool config, then fall back to narrow name heuristics only for unknown external/MCP tools.
