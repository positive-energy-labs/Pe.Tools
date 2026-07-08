export interface WorkbenchEndpointConfig {
  origin: string;
}

/**
 * Resolves the workbench server origin. Post-squash there is exactly one origin — the
 * host that serves this SPA — so this is just `window.location.origin`. No dev-port /
 * token query params, no injected globals: the browser talks to one origin for everything.
 * ponytail: window.location read kept as the one exception; revisit if prod ever needs it typed.
 */
export function resolveWorkbenchConfig(): WorkbenchEndpointConfig {
  if (typeof window === "undefined") return { origin: "" }; // SSR guard
  return { origin: window.location.origin };
}

/**
 * Build a URL against the workbench origin. Native @mastra/server routes live under `/api`
 * (`/api/agent-controller/...`); the Pe handshake + transparency endpoints under `/pe`.
 */
export function workbenchUrl(
  config: WorkbenchEndpointConfig,
  path: string,
  query: Record<string, string> = {},
): string {
  const url = new URL(path, config.origin || "http://localhost");
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

/** Pe handshake / transparency / send endpoints: `/pe/info`, `/pe/inspect`, `/pe/messages`. The
 * native @mastra/server routes are driven by `@mastra/client-js` (MastraClient), not these helpers. */
export function peUrl(config: WorkbenchEndpointConfig, path: string): string {
  return workbenchUrl(config, `/pe${path}`);
}
