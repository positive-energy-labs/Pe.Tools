import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import { podExecutor, podOperationBinding } from "./pod-executor.ts";
import { gatewayExecutor } from "./gateway-actions.ts";
import type { RevitBridge } from "./bridge.ts";
import { createHash } from "node:crypto";
import * as contracts from "@pe/agent-contracts";
import { type CommandExecutor } from "./command-executor.ts";
import { dirname } from "node:path";
import { z } from "zod";
import { type PodRouteDescriptor } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { createPackageLifecycle } from "./package-lifecycle.ts";
import { productRouteTrustPath } from "./product-paths.ts";
import { readJson, writeArtifact } from "./page-artifacts.ts";

const executableModules = new Map<
  string,
  { module: contracts.ExecutableRouteModule<CommandExecutor>; available: () => boolean }
>();
export function podCommand(key: string) {
  for (const { module, available } of executableModules.values()) {
    if (!available()) continue;
    const executor = module.bodies[key];
    if (executor && module.entries[key]?.effect === "command")
      return { executor, work: module.work };
  }
  return undefined;
}
export function admitPodModule(
  module: contracts.ExecutableRouteModule<CommandExecutor>,
  actualHash: string,
  workspace: RouteWorkspace,
  available = () => true,
) {
  contracts.validateExecutableRouteModule(module, actualHash);
  if (executableModules.has(module.key)) throw Error("Route module already admitted");
  for (const [key, executor] of Object.entries(module.bodies)) {
    if (podCommand(key)) throw Error(`Catalog key already admitted: ${key}`);
    if (executor.definition !== module.entries[key]) throw Error("Body and projection disagree");
    const operation = podOperationBinding(executor);
    if (!operation) throw Error("Pod bodies require the sealed operation adapter");
    if (executor.definition.effect === "command") {
      if (typeof operation.retires !== "function" || !executor.definition.dirties.length)
        throw Error("Pod ModelWrite requires retirement and reading invalidation declarations");
      const boundary = (
        executor.definition as contracts.Command & {
          writeBoundary?: { route: string; key: string; derive: unknown; preview: unknown };
        }
      ).writeBoundary;
      if (
        !boundary ||
        boundary.route !== module.work.route ||
        boundary.key !== key ||
        typeof boundary.derive !== "function" ||
        typeof boundary.preview !== "function"
      )
        throw Error("Pod commands require typed Work derive and preview bindings");
    }
  }
  const removeWork = workspace.register({ spec: module.work });
  executableModules.set(module.key, { module, available });
  contracts.admittedRouteEntries.set(module.key, { entries: module.entries, available });
  return () => {
    if (executableModules.get(module.key)?.module !== module) return;
    executableModules.delete(module.key);
    contracts.admittedRouteEntries.delete(module.key);
    removeWork();
  };
}

/** Resolve a catalog query before the normal /call metadata, policy and dispatch checks. */
export function podReadRequest(key: string, input: unknown) {
  for (const { module, available } of executableModules.values()) {
    if (!available() || !module.entries[key]) continue;
    const entry = module.entries[key]!;
    if (entry.effect !== "query") throw Error("Pod mutations require action admission");
    const op = podOperationBinding(module.bodies[key]!);
    if (!op) throw Error("Pod read adapter unavailable");
    return { key: op.key, request: op.input(entry.input.parse(input) as Record<string, unknown>) };
  }
  if (key.startsWith("pod.") && !isAnyOperationKey(key))
    throw Error(`Pod query unavailable: ${key}`);
  return { key, request: input };
}

const trustSchema = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/));

/** Trusted browser extensions have the shell's authority. Trust is local, explicit and content-pinned. */
export function createPodRoutes(
  lifecycle: ReturnType<typeof createPackageLifecycle>,
  options: { trustPath?: string; workspace?: RouteWorkspace; bridge?: RevitBridge["Service"] } = {},
) {
  const path = options.trustPath ?? productRouteTrustPath();
  const registrations = new Map<string, { hash: string; dispose: () => void }>();
  let tail = Promise.resolve();
  const decisions = () => readJson(path, trustSchema, {});
  let listing = Promise.resolve<PodRouteDescriptor[]>([]);
  function list(): Promise<PodRouteDescriptor[]> {
    const next = listing.then(readList, readList);
    listing = next;
    return next;
  }
  async function readList(): Promise<PodRouteDescriptor[]> {
    await lifecycle.ready;
    const trust = await decisions();
    const descriptors = lifecycle.packages().flatMap((pod) => {
      if (pod.diagnostics.some((d) => d.code === "InvalidRoute")) return [];
      return (pod.routes ?? []).map((route) => {
        const key = `route:@${pod.id}/${route.sourcePath}`;
        const member = pod.members.find((m) => m.path === route.sourcePath)!;
        return {
          ...route,
          key,
          packageId: pod.id,
          workRoute: `pod.${pod.id}.${route.sourcePath.split("/")[1]}`,
          sha256: member.sha256,
          trusted: trust[key] === member.sha256,
        };
      });
    });
    for (const [key, registration] of registrations) {
      if (
        !descriptors.some(
          (route) => route.key === key && route.trusted && route.sha256 === registration.hash,
        )
      ) {
        registration.dispose();
        registrations.delete(key);
      }
    }
    for (const route of descriptors) {
      if (route.trusted && !registrations.has(route.key) && options.workspace) {
        const pod = lifecycle.packages().find((pod) => pod.id === route.packageId)!;
        const bytes = pod.members.find((member) => member.path === route.sourcePath)!.bytes;
        const actualHash = createHash("sha256").update(bytes).digest("hex");
        if (actualHash !== route.sha256) throw Error("Route module hash mismatch");
        contracts.validatePodSource(Buffer.from(bytes).toString("utf8"));
        const loaded = await import(
          `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`
        );
        contracts.validatePodBundle(loaded);
        const declaration = loaded.register({
          ...contracts,
          z,
          descriptor: route,
        }) as contracts.PodModule;
        contracts.validatePodDeclaration(declaration);
        const module = {
          ...declaration,
          bodies: Object.fromEntries(
            Object.entries(declaration.entries).map(([key, definition]) => {
              const op = declaration.operations[key];
              if (!op) throw Error(`Missing Pod operation: ${key}`);
              if (!options.bridge) throw Error("Native bridge unavailable");
              return [
                key,
                podExecutor(
                  { ...op, definition },
                  gatewayExecutor(op.key, options.bridge, async () => {
                    throw Error("Native operation required");
                  }),
                ),
              ];
            }),
          ),
        };
        if (module.namespace !== route.packageId || module.graph.key !== route.workRoute)
          throw Error("Executable route identity differs from its admitted member");
        const dispose = admitPodModule(module, actualHash, options.workspace, () =>
          lifecycle
            .packages()
            .some(
              (pod) =>
                pod.id === route.packageId &&
                pod.members.some(
                  (member) => member.path === route.sourcePath && member.sha256 === actualHash,
                ),
            ),
        );
        registrations.set(route.key, { hash: route.sha256, dispose });
      }
    }
    return descriptors;
  }
  return {
    list,
    async trust(key: string, hash: string, trusted: boolean) {
      const write = tail.then(async () => {
        const route = (await list()).find((route) => route.key === key);
        if (!route || route.sha256 !== hash)
          throw Error("Route changed or is inactive; inspect its current bytes before trusting");
        const trust = await decisions();
        if (trusted) trust[key] = hash;
        else delete trust[key];
        await writeArtifact(dirname(path), path, JSON.stringify(trust), true);
      });
      tail = write.catch((error) => { console.error("pod-routes: asynchronous operation failed", error); });
      await write;
      return list();
    },
    async bundle(key: string, hash: string) {
      const route = (await list()).find((route) => route.key === key);
      if (!route || route.sha256 !== hash || !route.trusted)
        throw Error("Route trust is absent or its bytes changed");
      const pod = lifecycle.packages().find((pod) => pod.id === route.packageId)!;
      return Buffer.from(
        pod.members.find((member) => member.path === route.sourcePath && member.sha256 === hash)!
          .bytes,
      ).toString("utf8");
    },
    close() {
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
    },
  };
}
