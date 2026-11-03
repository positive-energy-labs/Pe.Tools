import type {
  HostRouteModule,
  HostWorkRegistration,
} from "../../../packages/agent-contracts/src/host-route-admission.ts";

/** Host composition supplies catalog closures before capture. Browser bindings never enter here. */
export function composeHostRouteRegistration(
  module: HostRouteModule,
  registrations: readonly HostWorkRegistration[],
): HostRouteModule {
  const registration = registrations.find((r) => r.spec.route === module.data.key);
  if (!registration || module.data.work?.route !== module.data.key) return module;
  const { spec, ...hostFields } = registration;
  return { ...module, workState: spec, ...hostFields };
}
