/// <reference path="./source-closure.d.ts" />
import { workFingerprintSchema, type RouteFingerprint } from "@pe/agent-contracts";
import { closureSchema } from "./builtin-closure.ts";
import type { TypedRoute } from "./typed-route";

/**
 * The web's builtin routes, discovered (ADR 0035 rule 4): Vite expands both globs at build and test
 * time, so a route directory joins by holding a `route.ts`. The host's registry is the generated
 * `apps/host/src/routes.generated.ts`; this file never reaches a `host.ts`.
 */
const declarations = import.meta.glob<{
  module: TypedRoute;
  router?: { dock?: boolean };
}>("../*/route.ts", { eager: true });
const closures = import.meta.glob<unknown>("../*/source-closure.generated.json", {
  eager: true,
  import: "default",
});

export interface WebRoute {
  readonly key: string;
  readonly module: TypedRoute;
  /** The dock draws this route; its address renders nothing. */
  readonly dock: boolean;
  /** The Work fingerprint this build mounts the route under: its builtin closure's. */
  readonly fingerprint: RouteFingerprint;
}

export const routeRegistry: Readonly<Record<string, WebRoute>> = Object.fromEntries(
  Object.entries(declarations).map(([path, { module, router }]) => {
    const folder = path.split("/")[1]!;
    const closure = closures[`../${folder}/source-closure.generated.json`];
    if (!closure) throw Error(`${module.data.key} has no builtin closure: run codegen:routes`);
    const key = module.data.key;
    return [key, { key, module, dock: router?.dock === true,
      fingerprint: workFingerprintSchema.parse(`builtin-closure:${closureSchema.parse(closure).fingerprint}`) }];
  }),
);

/** The builtin declared at `address`, or undefined. */
export const routeAt = (address: string) =>
  Object.values(routeRegistry).find((route) => route.module.data.address === address);
