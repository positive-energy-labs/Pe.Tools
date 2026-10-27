import type { CommandFactory, CommandRegistry } from "./command-executor.ts";
import type { RevitBridge } from "./bridge.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { familyExecutors, type FamilyActionDependencies } from "./family-actions.ts";
import { scheduleExecutors } from "./schedule-actions.ts";
import { instancesExecutors } from "./instances-actions.ts";
import { takeoffExecutors } from "./takeoff-actions.ts";
import { ductsExecutors } from "./ducts-actions.ts";
import { gatewayExecutor } from "./gateway-actions.ts";
import { bootstrapExecutor } from "./bootstrap.ts";
import { pagePublicationExecutor } from "./page-publication.ts";
import { pageLibrary } from "./pages-route.ts";
import { productPagesRootPath } from "./product-paths.ts";
import { hostCaptures } from "./captures-route.ts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";

/** One implementation registry; each factory creates its own immutable invocation context. */
export function commandRegistry(
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies,
  local: (key: string, input: unknown) => Promise<unknown>,
): CommandRegistry {
  const implementations: Record<string, CommandFactory> = {
    "machine.bootstrap": bootstrapExecutor(deps.sdk),
    "page.publish": pagePublicationExecutor(
      productPagesRootPath(),
      process.env[hostProcessIdentity.hostBaseUrlVariable] ||
        hostProcessIdentity.defaultHostBaseUrl,
      pageLibrary,
      hostCaptures(),
    ),
  };
  for (const group of [
    familyExecutors(captures, bridge, deps),
    scheduleExecutors(captures, bridge, deps),
    instancesExecutors(deps),
    takeoffExecutors(captures, bridge, deps),
    ductsExecutors(bridge, deps),
  ]) {
    for (const [key, factory] of Object.entries(group)) {
      if (implementations[key]) throw Error(`Command '${key}' has two executors`);
      implementations[key] = factory;
    }
  }
  return (key) => implementations[key] ?? gatewayExecutor(key, bridge, local, deps.sdk);
}
