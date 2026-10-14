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
  if (typeof window === "undefined") return { origin: "" };
  return { origin: window.location.origin };
}
