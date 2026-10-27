import type { CommandExecutor, CommandRegistry } from "./command-executor.ts";
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
import { readNativeReceipt } from "./native-receipts.ts";
import { Effect } from "effect";
import { CANCEL_OPERATION_KEY } from "./bridge.ts";
import { commands } from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";

/** Composed once for this exact runtime. Invocation-local facts live only in bind/prepare. */
export function commandRegistry(
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies,
  local: (key: string, input: unknown) => Promise<unknown>,
  origin?: () => string,
): CommandRegistry {
  const implementations: Record<string, CommandExecutor> = {
    "machine.bootstrap": bootstrapExecutor(deps.sdk),
    "page.publish": pagePublicationExecutor(
      productPagesRootPath(),
      origin ??
        (process.env[hostProcessIdentity.hostBaseUrlVariable] ||
          hostProcessIdentity.defaultHostBaseUrl),
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
  const recover: NonNullable<CommandExecutor["recover"]> = (step) => {
    if (!step.process) throw Error("No exact native process was captured for this step");
    return readNativeReceipt(step, step.process, deps.sdk);
  };
  const cancel = async (requestId: string) => {
    const answer = await Effect.runPromise(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }));
    const result = answer.value as { cancelled?: boolean; message?: string } | null;
    if (result?.cancelled === false) throw Error(result.message ?? "Native request is not running");
    return result;
  };
  const complete = (entry: CommandExecutor): CommandExecutor => ({
    ...entry,
    recover: entry.recover ?? recover,
    cancel: entry.cancel ?? cancel,
  });
  for (const [key, entry] of Object.entries(implementations))
    implementations[key] = complete(entry);
  for (const key of Object.keys(commands))
    if (!implementations[key]) throw Error(`Semantic command '${key}' has no executor`);
  return (key) =>
    (implementations[key] ??= complete(gatewayExecutor(key, bridge, local, deps.sdk)));
}
