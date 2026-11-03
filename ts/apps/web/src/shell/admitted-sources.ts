import { z } from "zod";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import type { ReadingSource } from "./readings";
const source = z.custom<ReadingSource>(
  (value) =>
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (value.kind === "derive"
      ? "derive" in value && typeof value.derive === "function"
      : value.kind === "use" && "open" in value && typeof value.open === "function"),
);
/** Resolve only executable references captured by this exact route's admission. */
export function admittedSources(route: AdmittedRoute): Record<string, ReadingSource> {
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(route);
  try {
    const bindings = resolveRouteBindings(registry, route);
    if (!bindings) throw Error("Foreign or retired source admission");
    return z.record(z.string(), source).parse(bindings.sources);
  } finally {
    registration.deactivate();
  }
}
