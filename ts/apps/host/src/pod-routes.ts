import { gatewayExecutor } from "./gateway-actions.ts";
import type { RevitBridge } from "./bridge.ts";
import { createHash } from "node:crypto";
import * as contracts from "@pe/agent-contracts";
import { command, type CommandExecutor } from "./command-executor.ts";
import { dirname } from "node:path";
import { z } from "zod";
import { podRouteWorkSpec, type PodRouteDescriptor } from "@pe/agent-contracts";
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
    if (executor) return { executor, work: module.work };
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
    if (executor.definition.effect === "command" && !("writeBoundary" in executor.definition))
      throw Error("Pod commands require the Work write boundary");
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
        const loaded = await import(
          `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`
        );
        const module = loaded.registerHost?.({
          ...contracts,
          z,
          command,
          descriptor: route,
          operation: (key: string) => {
            if (!options.bridge) throw Error("Native bridge unavailable");
            return gatewayExecutor(key, options.bridge, async () => {
              throw Error("Native operation required");
            });
          },
        });
        const dispose = module
          ? admitPodModule(module, actualHash, options.workspace, () =>
              lifecycle
                .packages()
                .some(
                  (pod) =>
                    pod.id === route.packageId &&
                    pod.members.some(
                      (member) => member.path === route.sourcePath && member.sha256 === actualHash,
                    ),
                ),
            )
          : options.workspace.register({ spec: podRouteWorkSpec(route.workRoute, route.name) });
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
      tail = write.catch(() => {});
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
