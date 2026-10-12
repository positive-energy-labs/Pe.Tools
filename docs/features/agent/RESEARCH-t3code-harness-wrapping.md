# Research: how T3 Code wraps lab harnesses

Source: the vendored clone at `.explore/t3code`, commit `7ab800a43c770b2c48a2d9306c89b6177f61ad4a` (2026-09-30). All citations are `path:line` relative to `.explore/t3code`. This is a read-only study. It changes nothing in the clone.

Question from Pea: should a lab harness be the "head" (the thread, the loop, the memory), with our UI as a wrapper only? How do auth and inference routing work if users bring their own lab subscription?

## 0. What T3 Code is

- T3 Code is a GUI over coding-agent harnesses. A Node WebSocket server wraps the provider CLIs and agents and serves web, desktop, and mobile clients. `AGENTS.md:3`
- The team calls it a "bring-your-own-subscription" alternative to Claude Desktop, Codex App, and Cursor. `AGENTS.md:5`
- The README says they sell nothing. It works with the user's existing subscriptions. `README.md:5-9`
- The term "provider" means "the agent runtime or harness T3 Code talks to". `AGENTS.md:51`

## 1. Harness ownership

### 1.1 Supported harnesses and protocols

| Harness | Protocol | Evidence |
|---|---|---|
| Claude Code | `@anthropic-ai/claude-agent-sdk` `query()` in-process, which spawns the `claude` binary | `apps/server/src/provider/Layers/ClaudeAdapter.ts:2-27`, `:4989` |
| Codex | `codex app-server` JSON-RPC over child stdio, through their own `effect-codex-app-server` package | `apps/server/src/provider/Layers/CodexSessionRuntime.ts:35-38`, `:1354`; `apps/server/src/provider/Layers/codexLaunchArgs.ts:13` |
| Cursor | ACP over stdio: `cursor-agent [-e endpoint] acp` | `apps/server/src/provider/acp/CursorAcpSupport.ts:56-61` |
| Grok Build | ACP over stdio: `grok ... agent stdio` | `apps/server/src/provider/acp/GrokAcpSupport.ts:33-39` |
| Antigravity | ACP (Google's ACP agent, a managed download) | `apps/server/src/provider/acp/AntigravityAcpSupport.ts:55-75`; `docs/user/providers-antigravity.md:3-5` |
| OpenCode | `@opencode-ai/sdk` HTTP client against `opencode serve` | `apps/server/src/provider/Layers/OpenCodeAdapter.ts:32`; `apps/server/src/provider/opencodeRuntime.ts:650`, `:684` |

- All ACP providers share one runtime, `AcpSessionRuntime`. `apps/server/src/provider/acp/AcpSessionRuntime.ts:761-880`
- One adapter contract covers all providers: `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `readThread`, `rollbackThread`, optional `compaction`, and one `streamEvents` stream. `apps/server/src/provider/Services/ProviderAdapter.ts:67-158`
- The rule is that provider protocols, account ownership, permissions, and capabilities stay at the adapter boundary. `docs/internals/providers.md:3-6`; `AGENTS.md:160`

### 1.2 Who owns the thread

- T3 owns the thread. A thread is "the durable conversation and work history for a project. It survives provider process exits." `docs/internals/glossary.md:15`
- A session is only "the provider runtime attached to a thread". T3 can stop and resume it without deleting the thread. `docs/internals/glossary.md:42`
- The harness owns the loop. T3 sends a turn and listens to events. It does not run the model loop itself. `apps/server/src/provider/Services/ProviderAdapter.ts:84-86`, `:157`
- T3 keeps its own thread identity even when Claude swaps its conversation id (for example after `/clear`). `apps/server/src/provider/Layers/ClaudeAdapter.ts:4251-4255`

### 1.3 Where the transcript lives

- T3 keeps an event-sourced log in SQLite. The event log is the source of truth. Projections are derived from it. `docs/internals/overview.md:173-179`
- The projection tables include messages, activities, turns, proposed plans, pending approvals, and sessions. `apps/server/src/persistence/Services/` (file list: `ProjectionThreadMessages.ts`, `ProjectionThreadActivities.ts`, `ProjectionThreadProposedPlans.ts`, `ProjectionPendingApprovals.ts`, `ProjectionThreadSessions.ts`)
- The harness keeps its own native transcript too. T3 does not replay its own copy into the model. It stores only a resume cursor per thread in `provider_session_runtime.resume_cursor_json`. `apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts:8-17`
- So there are two transcripts. T3's copy is for display. The harness copy is the model context.
- T3 reads the Claude native history with the SDK's `getSessionMessages` and `forkSession`. It uses them for rollback. `apps/server/src/provider/Layers/ClaudeAdapter.ts:15-16`, `:180-183`, `:5400`
- T3 can import old Claude and Codex sessions from their home directories. The import writes a resume cursor first, then copies user and assistant text into a T3 thread. `apps/server/src/project/AgentSessionImporter.ts:222-270`; `packages/contracts/src/agentSessions.ts:5-21`

### 1.4 Reattach and resume

- Claude: the resume cursor holds the Claude session UUID and the last assistant UUID. T3 passes them as `resume` and `resumeSessionAt`. `apps/server/src/provider/Layers/ClaudeAdapter.ts:982-1019`, `:2223-2226`, `:5017-5018`
- Codex: T3 calls `thread/resume` with the stored Codex thread id. On failure it logs a warning and calls `thread/start`, which is a fresh start. `apps/server/src/provider/Layers/CodexSessionRuntime.ts:753-784`
- ACP: the runtime uses `session/resume` or `session/load`, chosen per agent. `apps/server/src/provider/acp/AcpSessionRuntime.ts:87`, `:761-781`, `:822`
- ProviderService recovers a session from the persisted binding. It refuses when no resume state exists. `apps/server/src/provider/Layers/ProviderService.ts:1253-1291`
- A reaper stops idle sessions after 30 minutes. The thread stays. `apps/server/src/provider/Layers/ProviderSessionReaper.ts:17-18`

## 2. Auth

### 2.1 Default: defer to the harness login

- The README tells users to install each CLI and log in with it (`codex login`, `claude auth login`, `agent login`, `grok login`, `opencode auth login`). `README.md:16-23`
- Claude: "T3 Code uses Claude Code's login and configuration." `docs/user/providers-claude.md:3`
- For a Claude instance, T3 only sets `CLAUDE_CONFIG_DIR`. It does not set `HOME`, so the keychain stays reachable. `apps/server/src/provider/Drivers/ClaudeHome.ts:36-54`
- When Claude cannot authenticate, T3 tells the user to run `claude auth login` on the environment machine. `apps/server/src/provider/Drivers/ClaudeHome.ts:81-90`
- T3 probes the Claude account with an SDK session that never sends a prompt. So the probe makes no Anthropic API request. `apps/server/src/provider/Layers/ClaudeProvider.ts:320-331`
- Codex: T3 can use the existing `codex login`. `docs/user/providers-codex.md:22-26`
- Antigravity: the native process owns the token exchange and storage. T3 only forwards the OAuth callback. `docs/internals/providers.md:45-49`
- Setup must not happen as a health-check side effect. Probes avoid login and session creation. `docs/internals/providers.md:38-43`

### 2.2 Exceptions: where T3 holds a credential

- Managed Codex ("Connect with ChatGPT"): T3 runs its own OAuth PKCE flow. It asks for the scope `chatgpt.tokens.use.direct` on `https://api.openai.com/v1`. `apps/server/src/provider/CodexChatGptAuth.ts:31-32`
- T3 stores those tokens in its own secret store. It never writes the native `auth.json`. `apps/server/src/provider/CodexManagedRuntime.ts:18`; `apps/server/src/provider/ProviderCredentialStore.ts:5-20`; `apps/server/src/provider/CodexChatGptAuth.ts:155`
- T3 then launches Codex with a custom model provider `openai_token_sharing` that reads the token from `ACCESS_TOKEN`. It strips `OPENAI_API_KEY` and `OPENAI_BASE_URL`. `apps/server/src/provider/CodexManagedRuntime.ts:19-30`, `:90-98`
- The user doc calls this "sharing of your ChatGPT plan". Some features are not supported through sharing. `docs/user/providers-codex.md:5-13`
- Inference still runs inside Codex. T3 holds the token but does not call the model itself.
- Usage limits: T3 reads Claude's `.credentials.json` OAuth access token to call `/api/oauth/usage`. This is for limits and reset credits, not for inference. `apps/server/src/provider/Layers/claudeResetCredits.ts:155-176`
- Antigravity API-key mode stores the key in plain text in settings. `docs/user/providers-antigravity.md:46-48`
- Per-instance environment variables can carry keys. A variable has a `sensitive` flag. `packages/contracts/src/providerInstance.ts:104-109`; `apps/server/src/provider/ProviderInstanceEnvironment.ts:1-18`

### 2.3 Base URL and custom endpoints

- Claude: a separate instance with `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and an empty `ANTHROPIC_API_KEY` reaches OpenRouter. `docs/user/providers-claude.md:75-93`
- Claude: a local router such as Claude Code Router uses the same pattern. `docs/user/providers-claude.md:102-108`
- Claude: a cached Anthropic login can conflict with the router token. Run `/logout` first. `docs/user/providers-claude.md:87-89`
- Cursor: the instance can set an API endpoint, passed as `-e`. `apps/server/src/provider/acp/CursorAcpSupport.ts:58`
- OpenCode: T3 can connect to an external `opencode serve` URL with a password. `docs/user/providers-opencode.md:10-18`

### 2.4 T3's own identity layer

- T3 Connect uses Clerk for cloud identity. It manages environment links, credentials to reach environments, and tunnels. `docs/internals/t3-connect.md:3-6`
- The relay never gets the environment session token. `docs/internals/t3-connect.md:13-18`
- Each environment issues its own scoped sessions. A relay token is never an environment login. `docs/internals/environment-auth.md:3-5`
- Clerk gates remote access only. I found no billing or inference gate in the server or relay (search of `apps/server/src`, `infra`, `packages` for billing terms found only Clerk device flow and usage-limit readers).
- The Usage page shows estimated API-equivalent cost. It says these estimates are not the subscription bill. `docs/user/usage.md:9-11`

## 3. Model picking

- A selection is `{ instanceId, model, options }`. The instance id is the routing key. `packages/contracts/src/orchestration.ts:60-79`
- Discovery differs per harness:
  - Claude: a model manifest, bundled and refreshed from GitHub `main`. `docs/internals/model-manifest.md:3-17`; `apps/server/src/provider/ModelManifest.ts:40-41`
  - Codex: the app-server `model/list`, paged. `apps/server/src/provider/Layers/CodexProvider.ts:335-350`
  - Cursor, Grok, Antigravity: ACP session config options and `availableModels`. `apps/server/src/provider/Layers/CursorProvider.ts:347-353`; `apps/server/src/provider/Layers/GrokProvider.ts:219-224`; `apps/server/src/provider/Layers/AntigravityProvider.ts:49-58`
  - OpenCode: `client.provider.list`. `apps/server/src/provider/opencodeRuntime.ts:904`
- Users can add custom model ids per instance. `apps/server/src/provider/ClaudeModelCatalog.ts:75-86`; `docs/user/providers-claude.md:91-94`
- Sending the choice:
  - Claude: `model` in query options. `apps/server/src/provider/Layers/ClaudeAdapter.ts:4988`
  - Codex: `model` on each `turn/start`. `apps/server/src/provider/Layers/CodexSessionRuntime.ts:661-667`
  - ACP: `session/set_config_option` or the unstable `session/set_model`. `apps/server/src/provider/acp/AcpSessionRuntime.ts:255-277`
- All six adapters declare in-session model switch. `apps/server/src/provider/Layers/ClaudeAdapter.ts:5666`; `apps/server/src/provider/Layers/CodexAdapter.ts:2805`; `apps/server/src/provider/Layers/OpenCodeAdapter.ts:4040`; `apps/server/src/provider/Layers/CursorAdapter.ts:1273`
- A thread cannot switch driver. It cannot switch instance unless both share a continuation group (same home dir). `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:688-706`
- The Claude continuation group key is the resolved config dir. `apps/server/src/provider/Drivers/ClaudeHome.ts:56-64`
- Attribution in the UI is per thread, not per message. A message has no model field. `packages/contracts/src/orchestration.ts:574-584`
- The sidebar shows a provider-instance icon and name for the thread. `apps/web/src/components/Sidebar.tsx:388-400`
- T3 tells the model which harness and model it runs on, through an appended instruction. `apps/server/src/provider/RuntimeInstructions.ts:9-24`
- Codex emits `model/rerouted`. The adapter maps it to `model.rerouted`. I found no projection of it into the orchestration or web code. `apps/server/src/provider/Layers/CodexAdapter.ts:1942-1949`

## 4. Context

- T3 does not compact or summarize context itself. The adapter contract offers two compaction kinds: native (Codex) or a slash command sent as a turn (Claude `/compact`). `apps/server/src/provider/Services/ProviderAdapter.ts:30-43`; `apps/server/src/provider/Layers/ClaudeAdapter.ts:5668`; `apps/server/src/provider/Layers/CodexAdapter.ts:2810`
- For Claude, T3 only passes the `autoCompactWindow` setting through. `apps/server/src/provider/Layers/ClaudeAdapter.ts:4970-4972`; `docs/user/providers-claude.md:44-49`
- The web client shows a context-window meter and a "Compact context" action. `apps/web/src/components/chat/ContextWindowMeter.tsx:18-52`; `docs/user/providers-claude.md:51-54`
- Large tool outputs: T3 truncates only display text (activity details to 180 characters). It does not change what the model sees. `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:187`, `:573`
- Supervisor layer: T3 has none of its own. Subagents are the harness's native subagents. The Agents panel is "the fleet view over the native subagent fold". `apps/web/src/components/AgentsPanel.tsx:1-3`; `packages/client-runtime/src/state/subagentRuntime.ts:1-4`
- Codex multi-agent child threads map into the shared `task.*` lifecycle. `apps/server/src/provider/Layers/CodexAdapter.ts:1050-1057`
- Antigravity subagents come in batches. The user cannot open or control one subagent. `docs/user/providers-antigravity.md:106-109`
- Text generation (titles, commit messages, PR text) also runs through the harness, for example `claude -p`. `apps/server/src/textGeneration/ClaudeTextGeneration.ts:5`, `:200-202`

## 5. UI rendering

- Adapters translate native events into one canonical event union (session, turn, item, request, user-input, task, tool, account, MCP, runtime). `packages/contracts/src/providerRuntime.ts:152-200`
- Item types include `command_execution`, `file_change`, `mcp_tool_call`, `collab_agent_tool_call`, `plan`, and `context_compaction`. `packages/contracts/src/providerRuntime.ts:106-134`
- Request types include command, file-read, file-change, MCP elicitation, and permission approvals. `packages/contracts/src/providerRuntime.ts:137-149`
- Each event keeps an optional `raw` copy of the native payload. `packages/contracts/src/providerRuntime.ts:24-31`, `:215`
- The ingestion reactor turns `request.opened` into an `approval.requested` activity with a summary. `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:503-530`
- The web client derives tool cards from activities. `packages/client-runtime/src/work-log/toolPresentation.ts:108`
- Diffs come from T3, not the harness. Each turn ends with a checkpoint as a hidden git ref. `docs/internals/overview.md:190-200`; `AGENTS.md:145`

### 5.1 Approval round-trip

1. Claude calls `canUseTool`. The adapter emits `request.opened` and waits on a deferred. `apps/server/src/provider/Layers/ClaudeAdapter.ts:4778-4800`, `:4847`
2. The user clicks a decision. The client sends `thread.approval.respond` with one of `accept`, `acceptForSession`, `acceptAlways`, `decline`, `cancel`. `packages/contracts/src/orchestration.ts:147-153`, `:1369-1376`; `packages/client-runtime/src/operations/commands.ts:340`
3. The reactor calls `adapter.respondToRequest`. `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1630-1660`
4. The adapter maps the decision to a Claude `PermissionResult` (allow, allow with session permissions, or deny). `apps/server/src/provider/Layers/ClaudeAdapter.ts:4875-4894`

- Native option ids must survive normalization. A display label is not a valid reply. `docs/internals/providers.md:100-103`
- Permission modes are Supervised, Auto-accept edits, Auto, Full access. Providers enforce them differently. `docs/user/permission-modes.md:11-16`, `:23-25`

### 5.2 Plan proposal surface

- An interaction mode `plan` exists beside `default`. `packages/contracts/src/orchestration.ts:136`
- Claude: T3 catches `ExitPlanMode`, stores the plan as a proposed plan, and denies the tool with "wait for the user's feedback". `apps/server/src/provider/Layers/ClaudeAdapter.ts:4756-4775`
- Codex: T3 sends its own Plan Mode developer instructions. They tell the model to issue a `<proposed_plan>` block. The ingestion reactor buffers plan deltas into a proposed plan (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1409-1421`). `apps/server/src/provider/CodexDeveloperInstructions.ts:42-60`, `:194-198`
- A proposed plan records `implementedAt` and `implementationThreadId`. `packages/contracts/src/orchestration.ts:590-600`
- The user can "Implement" in place or "Implement in a new thread". `apps/web/src/components/chat/ComposerPrimaryActions.tsx:182-206`
- The new thread uses the composer's current model selection and links back with `sourceProposedPlan`. `apps/web/src/components/ChatView.tsx:9064-9128`

## 6. Custom tools and instructions

- T3 runs its own MCP HTTP server with preview, device, and pull-request toolkits. `apps/server/src/mcp/McpHttpServer.ts:14-42`
- Per thread, T3 issues a scoped bearer credential with capabilities. `apps/server/src/provider/Layers/ProviderService.ts:969-984`; `apps/server/src/mcp/McpProviderSession.ts:3-18`
- Injection per harness:
  - Claude: `mcpServers["t3-code"]` as `http` with an `Authorization` header. `apps/server/src/provider/Layers/ClaudeAdapter.ts:5024-5037`
  - Codex: `-c mcp_servers.t3-code.url=...` and a bearer token env var. `apps/server/src/provider/Layers/CodexAdapter.ts:2323-2339`
  - Cursor and Grok: ACP `mcpServers` in session setup. `apps/server/src/provider/Layers/CursorAdapter.ts:563-575`; `apps/server/src/provider/Layers/GrokAdapter.ts:1014-1022`
  - OpenCode: `client.mcp.add`, but only on a T3-managed server, not an external one. `apps/server/src/provider/Layers/OpenCodeAdapter.ts:2870-2878`
- Device tools also put a CLI shim on `PATH`, so the agent never handles a token. `apps/server/src/mcp/McpProviderSession.ts:13-17`, `:21-35`
- Tool instructions are omitted when the tools are absent. Describing missing tools would steer the model away from its real options. `apps/server/src/provider/CodexDeveloperInstructions.ts:28-41`
- Project instructions: the harness reads them itself. Claude gets `settingSources: ["user","project","local"]`. `apps/server/src/provider/Layers/ClaudeAdapter.ts:1558-1561`, `:4996`
- T3 only appends to the Claude Code preset system prompt. It does not replace it. `apps/server/src/provider/Layers/ClaudeAdapter.ts:4990-4995`
- For Codex, T3 puts its context in `turn/start.additionalContext`, not in the collaboration mode. Newer models drop client `developer_instructions`. `apps/server/src/provider/CodexDeveloperInstructions.ts:200-227`
- Skills come from the harness's own folders, per provider. `docs/user/providers-claude.md:64-73`; `docs/user/providers-antigravity.md:86-89`

## 7. Many harnesses at once

- Each thread has its own session. The adapter keys sessions by thread id. `apps/server/src/provider/Services/ProviderAdapter.ts:94-127`
- OpenCode uses one server per thread, so threads do not replace each other's MCP connection. `docs/internals/providers.md:14-19`
- A thread can use a separate git worktree. `docs/internals/glossary.md:14`; `docs/user/thread-sidebar.md:3-4`
- Fan-out: Shift-click several models to send one prompt. Each selection starts its own thread and worktree. `docs/user/thread-sidebar.md:39-42`; `apps/web/src/components/chat/ModelPickerContent.tsx:874`
- Multiple accounts: one instance per account. Instances route separately. `docs/internals/providers.md:8-10`; `docs/user/providers-claude.md:7-38`
- Handoff: a thread is bound to one driver. There is no cross-harness handoff inside a thread. `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:688-695`
- The only cross-thread handoff is a proposed plan implemented in a new thread (section 5.2).
- I found no "teammates" concept (search of server, web, packages, docs).

## 8. Their verdicts and recorded pain

- Why wrap: the product goal is bring-your-own-subscription and openness. `AGENTS.md:5`; `README.md:5-11`
- Where complexity lives: "Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb." `AGENTS.md:160`
- There is no ADR folder. `docs/internals/` holds the decisions. `AGENTS.md:129-132`
- Pain recorded:
  - Codex async questions arrive as notifications and need a new user message as the answer. `docs/internals/providers.md:90-94`
  - Capabilities must be real. Antigravity cannot roll back its conversation, so revert is rejected before files change. `docs/internals/providers.md:100-103`; `docs/user/providers-antigravity.md:80-82`
  - Claude holds a turn open during a usage-limit wait. The thread can look busy. `docs/user/providers-claude.md:58-61`
  - Claude: "the context refilled too quickly after compaction" and lost turn boundaries after compaction force a new thread. `apps/server/src/provider/Layers/ClaudeAdapter.ts:596`, `:5526`
  - OpenCode stores approval grants per directory, so T3 replies `once` to avoid widening permissions. `docs/internals/providers.md:21-23`
  - Antigravity needs credential isolation per instance and strips ambient Google credentials so no instance uses another account or billing project. `docs/internals/providers.md:25-31`
  - Managed ChatGPT refresh tokens rotate. Only one side may hold and refresh them. `docs/internals/providers.md:51-56`
  - The Claude adapter alone is 5684 lines; Codex is 2832 plus a 2740-line session runtime (measured with `wc -l` on `apps/server/src/provider/Layers/`).
  - Persisted event schemas must stay decodable on replay. A new attachment kind broke startup on older servers. `docs/internals/providers.md:112-115`; `docs/internals/overview.md:186-188`

## What this means for Pea

- T3 makes the harness the head of the loop and keeps only the thread record (section 1.2). Pea can take the same split: harness owns loop and model context, Pea owns the durable thread, approvals, and plan records.
- T3 keeps two transcripts: its own event log for display and the harness's native file for context, joined by a resume cursor (sections 1.3, 1.4). If Pea makes a harness the head, Pea's Mastra memory no longer is the model context; it becomes a display copy.
- T3 does no compaction and no tool-output reduction for the model (section 4). Pea's observational memory has no equivalent in a harness-head design; large Revit outputs would rely on the harness's own compaction, or on our MCP tools returning small results.
- T3 never calls a model API for inference, even for titles and commit text (sections 2.2, 4). "We never bill inference" is a proven, shipped posture for a harness wrapper.
- Default auth is the harness's own login, with config-dir isolation per account (section 2.1). Pea can defer to `claude auth login` and `codex login` and hold no keys.
- The one place T3 holds a token is OpenAI's plan-sharing scope `chatgpt.tokens.use.direct`, fed to Codex through a custom model provider (section 2.2). This is an OpenAI-sanctioned path; I found no Anthropic equivalent in T3.
- Base-URL routing is done by per-instance env vars on the harness (`ANTHROPIC_BASE_URL`, Cursor `-e`), not by T3 (section 2.3). Pea's OpenAI-compatible endpoint work would sit beside, not inside, a harness head.
- T3 injects product tools through one MCP HTTP server with a per-thread scoped bearer token, wired differently per harness (section 6). Pea's host operations could reach any harness the same way.
- Project instructions come from the harness reading its own files; T3 only appends a short runtime note (section 6). Pea's Revit context would need either harness-native files or an append block.
- A thread cannot change harness; handoff happens only through a plan opened in a new thread (sections 3, 5.2, 7). A Pea "head swap" mid-thread has no precedent here.
- The approval surface is a normalized request with native option ids, answered back through the adapter (section 5.1). Pea's propose/approve posture maps onto this shape for every harness.
- The per-harness cost is high: adapters of 1.3k to 5.7k lines, plus recorded protocol traps (section 8). Each added hand or head is a large adapter to own.
