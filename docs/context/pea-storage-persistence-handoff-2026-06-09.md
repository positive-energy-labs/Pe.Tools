# Pea storage/persistence roots handoff — 2026-06-09

## Objective

Investigate and stabilize Pea config/persistence roots. Pea storage/auth roots have churned; auth is currently reported broken; a requested Pea thread could not be found at its listed id even though same-resource Pea state exists elsewhere.

## User-provided target thread

```text
Title: (untitled)
ID: 1780966259973-a7cwcorsf
Resource: pea:f63071d01e9a716b
Created: 2026-06-09T00:50:59.973Z
Updated: 2026-06-09T01:22:24.027Z
```

## What was found

### Main default MastraCode/Peco DB

Path:

```text
C:\Users\kaitp\AppData\Roaming\mastracode\mastra.db
```

State observed:

- Exists.
- Very large: ~46.9 GB.
- Contains Peco/resource rows such as `resourceId = pe-tools-ae8e96592dd3`.
- Does **not** contain the requested Pea thread id `1780966259973-a7cwcorsf`.
- Does **not** contain `resourceId = pea:f63071d01e9a716b` for that requested thread.

This path comes from `source/pea/app/mastracode-storage.ts`:

```ts
getDefaultMastraCodeDatabasePath() => %APPDATA%/mastracode/mastra.db
```

and is used for `runtimeId === "Peco"` in `createPeaRuntimeStorage(...)`.

### Current Pea runtime DB

Path:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastra.db
```

Important sidecars:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastra.db-wal
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastra.db-shm
```

State observed:

- `mastra.db` itself was only 4096 bytes, but the WAL was active and contained current rows.
- This DB contains a Pea thread for the same resource:

```text
threadId: 1780970999158-hsajiltsv
resourceId: pea:f63071d01e9a716b
createdAt: 2026-06-09T02:09:59.158Z
updatedAt: 2026-06-09T02:20:48.723Z
```

- It does **not** contain the user-requested thread id `1780966259973-a7cwcorsf`.
- The active WAL contained script-tool evidence and same-resource Pea rows.

This path comes from normal Pea runtime code:

```ts
createPeaRuntimeStorage("pea", cwd, ".pea")
  => createPeaLocalStorage(cwd, ".pea")
  => path.join(cwd, ".pea", "mastra.db")
```

Relevant source:

- `source/pea/app/pea-runtime.ts`
- `source/pea/app/pea-runtime-policy.ts`
- `source/pea/app/mastracode-storage.ts`

### Pea nested MastraCode/auth-ish DB

Path:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastracode\mastra.db
```

State observed:

- Exists, ~155 MB.
- Did not contain the requested thread or same Pea resource row in normal table queries.
- Binary scan found generic tool schema/instruction strings and script history fragments, but not the requested target row.
- This path appears related to Pea’s auth/AppData redirection trick, not the main Pea memory DB.

Also present:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastracode\auth.json
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastracode\settings.json
```

### OAuth variant

Path checked:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea-oauth\mastracode\mastra.db
```

State observed:

- Exists but effectively empty/minimal at time of check.
- No useful Mastra tables/target thread rows found.

## Product/home roots involved

Host-reported settings workspace root:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\settings
```

Host operation used:

```text
settings.workspaces
```

`Pe.Shared.Product` says user content should be under Documents:

```text
ProductUserContentLayout.ForCurrentUser()
=> %Documents%\Pe.Tools
```

Relevant source:

- `source/Pe.Shared.Product/ProductUserContentLayout.cs`
- `source/Pe.Shared.Product/ProductRuntimeLayout.cs`
- `source/Pe.Shared.Product/ProductPathNames.cs`

Runtime product layout says runtime state/log/cache/binaries should be under Local AppData:

```text
%LOCALAPPDATA%\Positive Energy\Pe.Tools\state
%LOCALAPPDATA%\Positive Energy\Pe.Tools\logs
%LOCALAPPDATA%\Positive Energy\Pe.Tools\cache
%LOCALAPPDATA%\Positive Energy\Pe.Tools\bin
```

But Pea Mastra runtime DB currently lives under Documents user content (`Documents\Pe.Tools\.pea\mastra.db`), not under ProductRuntimeLayout state.

## Auth/root quirk to investigate

`source/pea/app/beta-auth-bootstrap.ts` resolves Pea auth path to:

```ts
resolveDefaultPeaMastraAuthPath(authSource)
=> join(await resolvePeProductHomePath(), authRoot, mastraAppDirectoryName, "auth.json")
```

For normal API-key auth this becomes approximately:

```text
C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastracode\auth.json
```

Then `createPea(...)` in `source/pea/app/pea-runtime.ts` does:

```ts
const mastraAuthPath = await preparePeaAuth(options);
process.env.APPDATA = dirname(dirname(mastraAuthPath));
```

Given `mastraAuthPath = ...\.pea\mastracode\auth.json`, this mutates:

```text
APPDATA = C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea
```

That likely causes MastraCode internals/auth storage to resolve paths under:

```text
%APPDATA%\mastracode\...
=> C:\Users\kaitp\OneDrive\Documents\Pe.Tools\.pea\mastracode\...
```

This is intentional-looking but fragile/global-process-wide. It may be a source of auth breakage or confusing persistence movement.

## Protocol session registry note

Separate from Mastra memory DB, protocol sessions default to:

```text
%LOCALAPPDATA%\Pe.Tools\pea\protocol-sessions\<runtime>-<protocol>.sessions.json
```

Relevant source:

```ts
source / pea / app / pea - runtime - session - registry.ts;
```

Specifically:

```ts
process.env.PEA_RUNTIME_SESSION_REGISTRY_DIR ||
  path.join(process.env.LOCALAPPDATA, "Pe.Tools", "pea", "protocol-sessions");
```

Note this does **not** use `Positive Energy\Pe.Tools` ProductRuntimeLayout and therefore is another divergent root convention.

## Search/query commands that were useful

Node LibSQL client was available via global pnpm package:

```text
@libsql/client
```

Useful DB schema query:

```js
select name,type from sqlite_master where type in ('table','view') order by name
```

Useful Mastra tables:

```text
mastra_threads(id, resourceId, title, metadata, createdAt, updatedAt)
mastra_messages(id, thread_id, content, role, type, createdAt, resourceId)
mastra_resources(id, workingMemory, metadata, createdAt, updatedAt)
```

When the DB file is tiny but `-wal` is active, normal LibSQL queries still saw WAL-backed rows for `Documents\Pe.Tools\.pea\mastra.db`; raw grep/binary scan of WAL also found current event content.

## Main quirks / risks

1. **Requested thread not found**
   - The exact thread id `1780966259973-a7cwcorsf` was absent from all checked plausible DBs.
   - Same resource exists in current Pea DB with a later thread id.
   - Likely explanation: storage root churn, thread created in a now-orphaned root, or protocol/session history shown from a different persistence layer than current Mastra memory DB.

2. **Multiple root conventions**
   - Peco: `%APPDATA%\mastracode\mastra.db`.
   - Pea runtime memory: `<cwd>\.pea\mastra.db`, where cwd resolves to `Documents\Pe.Tools`.
   - Pea auth/MastraCode internals: `Documents\Pe.Tools\.pea\mastracode\...` due to APPDATA mutation.
   - Protocol sessions: `%LOCALAPPDATA%\Pe.Tools\pea\protocol-sessions`, not under ProductRuntimeLayout.
   - Product runtime C# layout: `%LOCALAPPDATA%\Positive Energy\Pe.Tools\...`.

3. **Global APPDATA mutation**
   - `createPea` mutates `process.env.APPDATA` based on auth path.
   - This can affect all later libraries in-process that resolve `%APPDATA%`, not just auth.
   - This is likely a key place to audit for auth breakage and persistence drift.

4. **DB size / retention concern**
   - `%APPDATA%\mastracode\mastra.db` is ~46.9 GB.
   - Any persistence-root work should consider cleanup/retention/migration behavior, not just path changes.

## Recommended next steps for the persistence/auth agent

1. Draw a single intended root map for:
   - Pea memory DB
   - Pea auth JSON / OAuth state
   - Pea protocol session registry
   - Pea skills/config/settings
   - Peco DB/auth/config
   - Product runtime state/log/cache

2. Decide whether Pea runtime memory belongs under:
   - Documents user content (`Documents\Pe.Tools\.pea\mastra.db`), or
   - Product runtime state (`%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\pea\...`).

3. Replace or contain global `process.env.APPDATA` mutation if possible.
   - Prefer explicit auth storage path/config injection if MastraCode supports it.
   - If mutation must remain, isolate and document it loudly.

4. Align protocol session registry with product pathing or document why it deliberately uses a separate `%LOCALAPPDATA%\Pe.Tools` root.

5. Add a CLI/status command or diagnostic output that prints the active paths at Pea startup:
   - memory DB URL/path
   - auth path
   - protocol session registry path
   - cwd/workspace root
   - model/auth source

6. Add migration/lookup support for recently churned roots before deleting anything.
   - At minimum, print detected stale DBs and their latest thread/resource timestamps.

## Verification status

This handoff is based on source inspection plus live local filesystem/LibSQL queries. No code changes were made for persistence/auth. No auth repair was attempted.

## Related scripting diagnosis context

The same Pea DB contained script failures in thread `1780970999158-hsajiltsv`; those are separate from persistence/auth but confirm this was the active Pea runtime DB for current product use.

Observed script failure root causes:

- InlineSnippet with leading `using` directives was wrapped inside `Execute()`, causing Roslyn parse errors.
- Full container script used uppercase `Document` instead of `PeScriptContainer`’s lowercase `doc` property.

These should be fixed separately in scripting tool guidance/diagnostics.
