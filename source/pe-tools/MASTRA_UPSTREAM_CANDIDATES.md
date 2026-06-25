# Mastra Upstream Candidates

## Export a small public model resolver surface

Status 2026-06-24: still open after checking the synced upstream MastraCode source for the `0.25.0` / `0.25.1-alpha.1` line. `createMastraCode()` still returns `resolveModel`, but `mastracode/src/index.ts` does not show a root named `resolveModel` export. Pe.Tools should keep the public `createMastraCode({ disableHooks: true, disableMcp: true })` fallback until a small resolver export exists.

Pea needs MastraCode-owned model resolution so provider routing, OAuth/API-key behavior, gateway support, model aliases, thinking options, and fast-changing model names stay upstream of Pe.Tools.

Today `mastracode@0.22.3` exposes `resolveModel` in type declarations only through the object returned by `createMastraCode()`. The root runtime module exports `createAuthStorage` and `createMastraCode`, but not `resolveModel` or a lightweight resolver factory. Pea previously worked around this by scanning MastraCode's private `dist/chunk-*.js` files for an exported `resolveModel`, which breaks once Pea is packaged as a Vite+/tsdown SEA executable because there is no real `mastracode` package directory to scan at runtime.

Proposed upstream shape:

```ts
export function resolveModel(
  modelId: string,
  options?: {
    thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
    remapForCodexOAuth?: boolean;
    requestContext?: RequestContext;
  },
): MastraModelConfig;
```

An equivalent `createModelResolver()` or `createMastraCodeModelResolver()` public export would also work. The key request is a small public resolver API that does not require constructing a full MastraCode harness just to resolve a model handle.
