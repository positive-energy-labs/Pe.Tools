export interface WorkbenchEndpointConfig {
  origin: string;
  token?: string;
}

/**
 * Resolves the workbench server origin + token. The static SPA is served from a
 * different port than the runtime HTTP server, so we recover the server origin
 * (and token) from the `workbench` run-url param the static server appends to the
 * URL (`agui` is still accepted as a legacy fallback for old bookmarks).
 */
export function resolveWorkbenchConfig(): WorkbenchEndpointConfig {
  const params = new URL(window.location.href).searchParams;
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const seed =
    firstParam(params, "workbench", "runUrl", "agui") ?? env.VITE_PE_WORKBENCH_RUN_URL ?? undefined;

  let origin = window.location.origin;
  let token = params.get("token") ?? undefined;
  if (seed) {
    try {
      const url = new URL(seed, window.location.origin);
      origin = url.origin;
      token = url.searchParams.get("token") ?? token;
    } catch {
      // fall through to window origin
    }
  }
  return { origin, token };
}

export function workbenchUrl(
  config: WorkbenchEndpointConfig,
  path: string,
  query: Record<string, string> = {},
): string {
  const url = new URL(path, config.origin);
  if (config.token) url.searchParams.set("token", config.token);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

function firstParam(params: URLSearchParams, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return undefined;
}
