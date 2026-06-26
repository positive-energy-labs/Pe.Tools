export interface WorkbenchEndpointConfig {
  origin: string;
  token?: string;
}

/**
 * Resolves the workbench server origin + token. These are *connection* params (dev loopback
 * port `w` / token `t`), deliberately NOT part of the typed app search schema — they're a
 * dev/env concern, read once off the live URL. App navigation state (thread/mode/prompt) goes
 * through TanStack Router search; this stays out of it.
 * ponytail: window.location read kept as the one exception; revisit if prod ever needs it typed.
 */
export function resolveWorkbenchConfig(): WorkbenchEndpointConfig {
  if (typeof window === "undefined") return { origin: "" }; // SSR guard
  const params = new URL(window.location.href).searchParams;
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const injected = (window as Window & { __PE_WORKBENCH_URL__?: string }).__PE_WORKBENCH_URL__;

  let origin = window.location.origin;
  let token = firstParam(params, "t", "token");
  const workbenchPort = params.get("w");
  if (workbenchPort && /^\d+$/.test(workbenchPort)) {
    origin = `${window.location.protocol}//${window.location.hostname}:${workbenchPort}`;
    return { origin, token: token ?? "dev-loopback" };
  }

  const seed = injected ?? env.VITE_PE_WORKBENCH_RUN_URL ?? undefined;
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
  const url = new URL(path, config.origin || "http://localhost");
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
