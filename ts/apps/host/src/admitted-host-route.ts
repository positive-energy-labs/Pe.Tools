import type { RouteWorkspace } from "@pe/runtime";

/** Builtin source admission owns Work registration. Persisted Work is never removed here. */
export function registerAdmittedHostRoute(route: Parameters<RouteWorkspace["registerAdmitted"]>[0], workspace: RouteWorkspace) {
  return workspace.registerAdmitted(route);
}
