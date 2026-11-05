import type { ActionJournal } from "./action-journal.ts";
import { commandResources } from "./command-reads.ts";
import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import { workIntentBoundary, workWriteBoundary } from "./work-write-boundary.ts";
import { catalogCommandContext } from "./catalog-command-context.ts";
import type { CommandExecutor, CommandRegistry } from "./command-executor.ts";
import type { RevitBridge } from "./bridge.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { familyExecutors, type FamilyActionDependencies } from "./family-actions.ts";
import { scheduleExecutors } from "./schedule-actions.ts";
import { instancesExecutors, type InstancesActionDependencies } from "./instances-actions.ts";
import { takeoffExecutors } from "./takeoff-actions.ts";
import { ductsExecutors } from "./ducts-actions.ts";
import { dataTableExecutors } from "./data-table-actions.ts";
import { gatewayExecutor } from "./gateway-actions.ts";
import { bootstrapExecutor } from "./bootstrap.ts";
import { pagePublicationExecutor } from "./page-publication.ts";
import { pageLibrary } from "./pages-route.ts";
import { productPagesRootPath } from "./product-paths.ts";
import { hostCaptures } from "./captures-route.ts";
import { readNativeReceipt } from "./native-receipts.ts";
import { Effect } from "effect";
import { CANCEL_OPERATION_KEY } from "./bridge.ts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { commands, type WriteBoundaryBinding } from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";

/** Composed once for this exact runtime. Invocation-local facts live only in bind/prepare. */
export function commandRegistry(
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies & InstancesActionDependencies,
  local: (key: string, input: unknown) => Promise<unknown>,
  origin?: () => string,
): CommandRegistry {
  const implementations: Record<string, CommandExecutor> = {
    "machine.bootstrap": bootstrapExecutor(deps.sdk),
    "page.publish": pagePublicationExecutor(
      productPagesRootPath(),
      // Read at publish time: the bound port is known only after the claim, and may not be 5180.
      origin ??
        (() =>
          process.env[hostProcessIdentity.hostBaseUrlVariable] ||
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
    dataTableExecutors(bridge, deps),
  ]) {
    for (const [key, factory] of Object.entries(group)) {
      if (implementations[key]) throw Error(`Command '${key}' has two executors`);
      if (
        commandCatalogAxes[key as keyof typeof commandCatalogAxes]?.effect === "ModelWrite" &&
        !factory.seal
      )
        throw Error(`ModelWrite ${key} requires a producer-owned seal projection`);
      implementations[key] = factory;
    }
  }
  const recover: NonNullable<CommandExecutor["recover"]> = (step) => {
    if (!step.process) throw Error("No exact native process was captured for this step");
    return readNativeReceipt(step, step.process, deps.sdk);
  };
  const cancel = async (requestId: string) => {
    // effect-edge: island, phase 5
    const answer = await Effect.runPromise(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }));
    const result = answer.value as { cancelled?: boolean; message?: string } | null;
    if (result?.cancelled === false) throw Error(result.message ?? "Native request is not running");
    return result;
  };
  const complete = (entry: CommandExecutor, key?: string): CommandExecutor => ({
    ...entry,
    bind: (context) =>
      key ? catalogCommandContext.run(key, () => entry.bind(context)) : entry.bind(context),
    run: (context, execution) =>
      key
        ? catalogCommandContext.run(key, () => entry.run(context, execution))
        : entry.run(context, execution),
    recover: entry.recover ?? recover,
    cancel: entry.cancel ?? cancel,
  });
  // A preview entry with no executor of its own is the write's executor bound in its preview phase:
  // it runs the same bind/prepare and returns the sealed request without calling the write leaf.
  const ownExecutors = new Set(Object.keys(implementations));
  for (const [key, definition] of Object.entries(commands)) {
    const boundary = (definition as { writeBoundary?: WriteBoundaryBinding }).writeBoundary;
    if (boundary?.phase !== "preview" || implementations[key]) continue;
    const write = implementations[boundary.key];
    if (!write) throw Error(`Preview ${key} has no write executor ${boundary.key}`);
    implementations[key] = { ...write, definition };
  }
  // The wrap is keyed on the catalog axis, never on a definition's shape: a ModelWrite whose
  // definition carries no typed apply-phase `writeBoundary` is refused at boot instead of running unsealed.
  // Previews (TransactRead) carry the preview phase and are wrapped too; every other command is untouched.
  for (const [key, entry] of Object.entries(implementations)) {
    const modelWrite =
      commandCatalogAxes[key as keyof typeof commandCatalogAxes]?.effect === "ModelWrite";
    const boundary =
      typeof entry.definition !== "function" && "writeBoundary" in entry.definition
        ? (entry.definition.writeBoundary as WriteBoundaryBinding)
        : undefined;
    if (modelWrite && boundary?.phase !== "apply")
      throw Error(
        `ModelWrite ${key} has no typed apply writeBoundary; build it with workWriteCommands`,
      );
    // A Work command with no seal (a SessionWrite capture) only derives its input from Work.
    const intent = "workIntent" in (typeof entry.definition === "function" ? {} : entry.definition);
    if (modelWrite !== (boundary?.phase === "apply"))
      throw Error(`${key}: the seal follows the axis; only ModelWrite has a write boundary`);
    const wrapped =
      !boundary && intent
        ? workIntentBoundary(entry, bridge, deps)
        : boundary
          ? workWriteBoundary(
              entry,
              bridge,
              deps,
              undefined,
              ownExecutors.has(key) && boundary.phase === "preview",
            )
          : entry;
    if (modelWrite && wrapped.boundary !== "work")
      throw Error(`ModelWrite ${key} is not behind the Work write boundary`);
    implementations[key] = complete(wrapped, key);
  }
  for (const key of Object.keys(commands))
    if (!implementations[key]) throw Error(`Semantic command '${key}' has no executor`);
  return (key) => {
    if (key.startsWith("pod.") && !isAnyOperationKey(key))
      throw Error(`Pod command unavailable: ${key}`);
    return (implementations[key] ??= complete(gatewayExecutor(key, bridge, local, deps.sdk)));
  };
}

/** The HTTP host and embedded runtimes acquire the same registry and resource authority. */
export function bindCommandRuntime(
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies & InstancesActionDependencies,
  local: (key: string, input: unknown) => Promise<unknown>,
  origin?: () => string,
): void {
  owner.bindCommands({
    ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
    resolve: commandRegistry(bridge, captures, deps, local, origin),
  });
}
