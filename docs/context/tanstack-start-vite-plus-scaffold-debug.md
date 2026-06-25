# TanStack Start Vite+ Scaffold Debug Record

Date: 2026-06-25

Scope: `source/pe-tools/apps/web`, a new TanStack Start app scaffold being adapted to the repo's `vp` / Vite+ toolchain.

Status: fixed locally. Keep the workaround small and removable.

## Summary

The browser failure was not one app bug. It was a stacked toolchain mismatch:

1. The near-stock TanStack Start scaffold expected normal Vite.
2. The repo app was moved to `vite-plus` and `vp dev`.
3. Current TanStack Start dev-server middleware skips registration under Vite 8 / Vite+.
4. A local `ssr.noExternal: true` setting then forced React through the Vite+ SSR evaluator and created a second runtime failure.
5. Strict repo checks surfaced scaffold residue: route-tree formatting drift, missing Vite client types, and unused imports.

Final decision: keep Vite+ and add one dev-only local middleware shim in `apps/web/vite.config.ts` that feature-checks `server.environments.ssr.runner.import`, imports `virtual:tanstack-start-server-entry`, and forwards document requests to its `fetch` handler.

## Initial Symptom

User report: new TanStack Start scaffold returned browser-console HTTP failure while running:

```powershell
cd source/pe-tools/apps/web
vp run dev
# effectively: vp dev --port 3000
```

Observed during diagnosis:

- `vp dev --port 3100` started and served Vite client assets.
- `GET /@vite/client` returned `200`.
- `GET /` and `GET /about` initially returned route fallthrough rather than rendered Start HTML.
- The important split was "Vite dev server alive" vs "TanStack Start SSR document middleware missing."

## Local Versions Involved

Verified from installed packages and command output:

- `@tanstack/react-start`: `1.168.26`
- `@tanstack/start-plugin-core`: `1.171.18`
- `@tanstack/router-generator`: `1.167.17`
- `vite-plus`: repo catalog dependency, dev output `VITE+ v0.2.0`
- Vite build output: `vite v8.0.16`

The app package intentionally has `vite-plus: "catalog:"` and no direct `vite` dev dependency.

## Failure Chain

### 1. Stock Start config did not match repo toolchain

The staged scaffold used:

```ts
import { defineConfig } from "vite";
```

The repo command path uses `vp dev`, and this app's unstaged package shape uses `vite-plus`, not direct Vite. That made the config import and TypeScript client types wrong for the adapted app.

Decision:

- Use `defineConfig` and `Plugin` from `vite-plus`.
- Use `types: ["vite-plus/client", "node"]`.
- Do not re-add direct `vite` just to satisfy scaffold defaults.

### 2. TanStack Start dev SSR middleware was skipped under Vite+ / Vite 8

Installed source inspected:

`source/pe-tools/node_modules/.pnpm/@tanstack+start-plugin-core_*/node_modules/@tanstack/start-plugin-core/dist/esm/vite/dev-server-plugin/plugin.js`

Relevant installed logic:

```js
if (installMiddleware == void 0) {
  if (viteDevServer.config.server.middlewareMode) return;
  if (!isRunnableDevEnvironment(serverEnv) || "dispatchFetch" in serverEnv) return;
}
if (!isRunnableDevEnvironment(serverEnv)) throw new Error(
  "cannot install vite dev server middleware for TanStack Start since the SSR environment is not a RunnableDevEnvironment"
);
```

The upstream issue matches this shape: on Vite 8 / Vite+, TanStack Start silently skips SSR middleware, document routes fall through, and forcing `installDevServerMiddleware` exposes a second guard problem.

Reference:

- https://github.com/TanStack/router/issues/7614

Decision:

- Do not patch `node_modules`.
- Do not pin the repo app back to Vite 7.
- Do not enable `tanstackStart({ vite: { installDevServerMiddleware: true } })`, because that path hits the same brittle `RunnableDevEnvironment` identity check.
- Add an app-local dev-only shim using the behavior the middleware actually needs: `server.environments.ssr.runner.import`.

### 3. First shim attempt lost the runner method binding

The first shim extracted the method:

```ts
const importServerEntry = ssr?.runner?.import;
await importServerEntry("virtual:tanstack-start-server-entry");
```

Runtime result:

```text
Internal server error: Cannot read properties of undefined (reading 'cachedModule')
```

Cause: Vite+'s module runner import method expects its runner object as `this`.

Decision:

```ts
const importServerEntry = runner.import.bind(runner);
```

This kept the shim small and avoided recreating the TanStack plugin.

### 4. `ssr.noExternal: true` made React fail in SSR

After the middleware started running, document routes returned `500`:

```text
Internal server error: module is not defined
at react/index.js
```

Cause: `ssr.noExternal: true` forced React's CommonJS entry through the Vite+ SSR evaluator. The stock scaffold did not have this setting.

Decision:

- Remove `ssr.noExternal: true`.
- Keep `resolve.dedupe: ["react", "react-dom"]`, which is the smaller and more appropriate monorepo guard.

### 5. Strict repo checks found scaffold residue

`vp check` also caught non-runtime issues:

- `routeTree.gen.ts` generation fought repo formatting defaults.
- `tsconfig.json` referenced `vite/client` despite the app depending on `vite-plus`.
- `src/router.tsx` imported unused scaffold symbols while `noUnusedLocals` was enabled.

Decision:

- Set router generation style in both `tsr.config.json` and the Start plugin router option:

```json
{
  "target": "react",
  "quoteStyle": "double",
  "semicolons": true
}
```

- Remove unused imports from `src/router.tsx`.
- Keep checks strict; do not disable `noUnusedLocals`.

## Final Shape

Files intentionally touched:

- `source/pe-tools/apps/web/vite.config.ts`
- `source/pe-tools/apps/web/tsconfig.json`
- `source/pe-tools/apps/web/tsr.config.json`
- `source/pe-tools/apps/web/src/router.tsx`

Core decision in `vite.config.ts`:

```ts
// ponytail: remove once TanStack Start registers its dev SSR middleware for Vite+.
function tanstackStartVite8DevMiddleware(): Plugin {
  // feature-check server.environments.ssr.runner.import
  // import virtual:tanstack-start-server-entry
  // call default.fetch(Request)
  // write Response back to Node res
}
```

Why this is the least bad local shape:

- Keeps the repo on Vite+ / `vp`, matching the surrounding workspace.
- Does not mutate installed package artifacts.
- Does not downgrade Vite or fork the scaffold.
- Is dev-only via `apply: "serve"`.
- Is marked with a removal trigger.
- Production build still uses TanStack Start's normal build path.

## Alternatives Rejected

Patch `node_modules`:

- Rejected because it is local, fragile, and disappears on install.

Pin Vite 7:

- Rejected because the repo is already moving through `vp` / Vite+, and this app is a new scaffold rather than legacy compatibility work.

Re-add direct `vite` and use stock scaffold config:

- Rejected because every other app/package is expected to follow repo `vp` commands and the user specifically wanted those as reference.

Use `installDevServerMiddleware: true`:

- Rejected because the upstream issue and installed code show it can trip the second `isRunnableDevEnvironment` identity guard.

Keep `ssr.noExternal: true`:

- Rejected because it caused React SSR failure with `module is not defined`.

Add a full custom server:

- Rejected as unnecessary. The only missing piece was the document request handler during dev.

## Verification

Proof lane: local web dev server, no Revit/RRD involvement.

Commands run from `source/pe-tools/apps/web`:

```powershell
vp check
vp build
```

Throwaway dev proof from `source/pe-tools`:

```powershell
Start-Process -FilePath "cmd.exe" `
  -ArgumentList @("/c", "vp dev --port 3100") `
  -WorkingDirectory ".\apps\web" `
  -WindowStyle Hidden
```

HTTP probes:

```text
GET /             -> 200 text/html
GET /about        -> 200 text/html
GET /@vite/client -> 200 text/javascript
```

Final command results:

- `vp check`: formatted, no warnings, no lint errors, no type errors.
- `vp build`: client build passed, SSR build passed.

## Future Removal Trigger

Delete `tanstackStartVite8DevMiddleware()` when either is true:

- The installed TanStack Start plugin no longer skips dev SSR middleware under Vite+ / Vite 8+.
- The app no longer runs TanStack Start through Vite+.

Removal proof:

1. Remove the shim from `vite.config.ts`.
2. Run `vp check`.
3. Start `vp dev --port <free-port>`.
4. Verify `GET /`, `GET /about`, and `GET /@vite/client` all return `200`.
5. Run `vp build`.

## Practical Debug Rule

For future Start/Vite+ scaffold failures, split probes immediately:

```text
/@vite/client 200 + / 404   = Vite server alive, Start document middleware missing.
/ 500 with react/index.js   = SSR evaluator/dependency externalization problem.
vp check routeTree drift    = router generator formatting config mismatch.
```

Do not diagnose this class of failure from the browser console alone.
