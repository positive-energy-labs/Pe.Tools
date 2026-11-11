import type { BuiltinClosure, HostRouteModule } from "@pe/agent-contracts";

/**
 * One row of the one generated route registry, `routes.generated.ts` (ADR 0035 rule 4; slice 5a,
 * `docs/features/routes/REGISTRY-SHAPE.md`). The generator writes static imports because the host
 * is packed by rolldown and run under jiti: neither follows a glob or a computed import.
 */
export interface RouteRegistryRow {
  /** `module.data.key`. */
  readonly key: string;
  readonly closure: { readonly fingerprint: string; readonly envelope: BuiltinClosure };
  /** Closure data, the work projection, and the reads and leaves of `<folder>/host.ts`. */
  readonly host: HostRouteModule;
}
export type RouteRegistry = Readonly<Record<string, RouteRegistryRow>>;
