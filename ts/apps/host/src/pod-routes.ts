import { dirname } from "node:path";
import { z } from "zod";
import { podRouteWorkSpec, type PodRouteDescriptor } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { createPackageLifecycle } from "./package-lifecycle.ts";
import { productRouteTrustPath } from "./product-paths.ts";
import { readJson, writeArtifact } from "./page-artifacts.ts";

const trustSchema = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/));

/** Trusted browser extensions have the shell's authority. Trust is local, explicit and content-pinned. */
export function createPodRoutes(
  lifecycle: ReturnType<typeof createPackageLifecycle>,
  options: { trustPath?: string; workspace?: RouteWorkspace } = {},
) {
  const path = options.trustPath ?? productRouteTrustPath();
  const registrations = new Map<string, { hash: string; dispose: () => void }>();
  let tail = Promise.resolve();
  const decisions = () => readJson(path, trustSchema, {});
  async function list(): Promise<PodRouteDescriptor[]> {
    await lifecycle.refresh();
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
        const dispose = options.workspace.register({
          spec: podRouteWorkSpec(route.workRoute, route.name),
        });
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
