import type { ActionJournal } from "./action-journal.ts";
import type { HostNativeRead } from "@pe/host-internal/native-read";
import { commandResources } from "./command-reads.ts";
import { workStartExecutor } from "./work-start.ts";
import { findingsExecutors } from "./slots/findings.ts";
import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import { workIntentBoundary, workWriteBoundary } from "./work-write-boundary.ts";
import { CatalogCommand, catalogCommandContext } from "./catalog-command-context.ts";
import type { CommandExecutor, CommandRegistry } from "./command-executor.ts";
import type { GatewayLocal } from "./gateway-actions.ts";
import type { RevitBridge } from "./bridge.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { familyExecutors, type FamilyActionDependencies } from "./family-actions.ts";
import { scheduleExecutors } from "./schedule-actions.ts";
import { instancesExecutors, type InstancesActionDependencies } from "./instances-actions.ts";
import { takeoffExecutors } from "./takeoff-actions.ts";
import { ductsExecutors } from "./ducts-actions.ts";
import { catalogWorkExecutors } from "./catalog-work-actions.ts";
import { sheetExecutors } from "./slots/sheet.ts";
import { gatewayExecutor } from "./gateway-actions.ts";
import { bootstrapExecutor } from "./bootstrap.ts";
import { pagePublicationExecutor } from "./page-publication.ts";
import { pageLibrary } from "./pages-route.ts";
import { productPagesRootPath } from "./product-paths.ts";
import { readNativeReceipt } from "./native-receipts.ts";
import { Effect } from "effect";
import { CANCEL_OPERATION_KEY } from "./bridge.ts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { catalogWorkSpecs, commands, type WriteBoundaryBinding } from "@pe/agent-contracts";
import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";

/** Composed once for this exact runtime. Invocation-local facts live only in bind/prepare. */
export function commandRegistry(
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies & InstancesActionDependencies & { nativeRead?: HostNativeRead["Service"] },
  local: GatewayLocal,
  origin?: () => string,
): CommandRegistry {
  const implementations: Record<string, CommandExecutor> = {
    "work.start": workStartExecutor(deps.workspace),
    "machine.bootstrap": bootstrapExecutor(deps.sdk),
    "page.publish": pagePublicationExecutor(
      productPagesRootPath(),
      // Read at publish time: the bound port is known only after the claim, and may not be 5180.
      origin ??
        (() =>
          process.env[hostProcessIdentity.hostBaseUrlVariable] ||
          hostProcessIdentity.defaultHostBaseUrl),
      pageLibrary,
      deps.pictures!,
    ),
  };
  // The ducts losses half of the sheet pair answers through the sheet dispatcher, not as its own entry.
  const ducts = ductsExecutors(bridge, deps) as Record<string, CommandExecutor>;
  const ductsWithoutSheet = Object.fromEntries(
    Object.entries(ducts).filter(([key]) => !(Object.values(SHEET_COMMANDS) as string[]).includes(key)),
  );
  for (const group of [
    familyExecutors(captures, bridge, deps),
    scheduleExecutors(captures, bridge, deps),
    instancesExecutors(deps),
    takeoffExecutors(captures, bridge, deps),
    ductsWithoutSheet,
    sheetExecutors(bridge, deps, ducts),
    catalogWorkExecutors(bridge, deps),
    findingsExecutors(deps.workspace),
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
  const cancel = (requestId: string) =>
    Effect.flatMap(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }), ({ value }) => {
      const result = value as { cancelled?: boolean; message?: string } | null;
      return result?.cancelled === false
        ? Effect.fail(Error(result.message ?? "Native request is not running"))
        : Effect.succeed(result);
    });
  const complete = (entry: CommandExecutor, key?: string): CommandExecutor => {
    const definition = entry.definition;
    return {
      ...entry,
      definition: key && typeof definition === "function"
        ? context => catalogCommandContext.run(key, () => definition(context))
        : definition,
      bind: (context) =>
        key ? catalogCommandContext.run(key, () => entry.bind(context)) : entry.bind(context),
      run: (context, execution) =>
        key
          ? entry.run(context, execution).pipe(Effect.provideService(CatalogCommand, key))
          : entry.run(context, execution),
      recover: entry.recover ?? recover,
      cancel: entry.cancel ?? cancel,
    };
  };
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
  // Plans (Read or rolled-back TransactRead) carry the preview phase and are wrapped too; every other command is untouched.
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
              // A route-free catalog owner has no tool; its Work spec is the catalog entry's.
              catalogWorkSpecs[boundary.route as keyof typeof catalogWorkSpecs],
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
    return (implementations[key] ??= complete(gatewayExecutor(key, bridge, local, deps.pictures!, deps.sdk), key));
  };
}

/** The HTTP host and embedded runtimes acquire the same registry and resource authority. */
export function bindCommandRuntime(
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  deps: FamilyActionDependencies & InstancesActionDependencies & { nativeRead?: HostNativeRead["Service"] },
  local: GatewayLocal,
  origin?: () => string,
): void {
  owner.bindCommands({
    ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
    resolve: commandRegistry(bridge, captures, deps, local, origin),
  });
}
