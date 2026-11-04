import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { AcceptanceOwner } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createRouteEnvironment, type EnvironmentOptions } from "./route-environment";
import { createFixtureRouteEnvironment, selectRouteEnvironment } from "./fixture-lane";

/** Composition retains mint authority. Owners receive only the selected capabilities. */
export function createMountEnvironment<G extends RouteGraphJson, S extends SchemaTable>(options: {
  readonly route: AdmittedRoute;
  readonly search: Record<string, unknown>;
  readonly acceptance: Pick<AcceptanceOwner<G, S>, "current">;
  readonly common: Omit<EnvironmentOptions, "ports">;
  readonly live: () => EnvironmentOptions["ports"];
  readonly fixture: (
    name: string,
  ) => Omit<Parameters<typeof createFixtureRouteEnvironment>[0], "issuer" | "validate">;
}) {
  const { validate } = options.common;
  const common = {
    ...options.common,
    validate: {
      ...validate,
      admitted: (route: AdmittedRoute) => route === options.route && validate.admitted(route),
      token: (token: Parameters<typeof validate.token>[0]) =>
        options.acceptance.current(token) && validate.token(token),
      scope: (scope: Parameters<typeof validate.scope>[0]) =>
        options.acceptance.current(scope) && validate.scope(scope),
      invocation: (invocation: Parameters<typeof validate.invocation>[0]) =>
        options.acceptance.current(invocation) && validate.invocation(invocation),
    },
  };
  const selected = selectRouteEnvironment({
    search: options.search,
    live: () => createRouteEnvironment({ ...common, ports: options.live() }),
    fixture: (name) => createFixtureRouteEnvironment({ ...options.fixture(name), ...common }),
  });
  return { ...selected, route: options.route };
}
export type MountEnvironment = ReturnType<typeof createMountEnvironment>;
