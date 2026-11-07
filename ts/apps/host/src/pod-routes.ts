import type { RevitBridge } from "./bridge.ts";
import * as contracts from "@pe/agent-contracts";
import { dirname } from "node:path";
import { z } from "zod";
import { type PodRouteDescriptor } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { HostAdmittedRoute } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import type { createPackageLifecycle } from "./package-lifecycle.ts";
import { productRouteTrustPath } from "./product-paths.ts";
import { readJson, writeArtifact } from "./page-artifacts.ts";
import { admitPodArtifact, verifyPodArtifact } from "./pod-artifact.ts";
import { registeredReads } from "./reads/routes.ts";

/** Builtin source admission and verified Pod-byte admission share this host-owned door.
 * The caller supplies the exact authenticated handle, never a browser schema or migration. */
export function registerAdmittedHostRoute(
  route: contracts.AdmittedRoute | HostAdmittedRoute,
  workspace: RouteWorkspace,
): ReturnType<RouteWorkspace["registerAdmitted"]> {
  // Builtins joined the same registry at startup. A verified Pod owns its runtime entries.
  const captured = route.fingerprint.startsWith("pod-bytes:")
    ? contracts.captureAdmittedHostBindings(route)
    : undefined;
  let unregister = () => {};
  try {
    if (captured) {
      const bindings = captured.bindings;
      unregister = registeredReads.register(
        "reads" in bindings ? bindings.reads : undefined,
        "leaves" in bindings ? bindings.leaves : undefined,
      );
    }
    const work = workspace.registerAdmitted(route);
    return {
      ready: work.ready.then((failure) => {
        if (failure) {
          unregister();
          captured?.deactivate();
        }
        return failure;
      }),
      close: () => {
        unregister();
        captured?.deactivate();
        work.close();
      },
    };
  } catch (error) {
    unregister();
    captured?.deactivate();
    throw error;
  }
}

const trustSchema = z.record(z.string(), z.string().regex(/^pod-bytes:[a-f0-9]{64}$/));

/** Trusted browser extensions have the shell's authority. Trust is local, explicit and content-pinned. */
export function createPodRoutes(
  lifecycle: ReturnType<typeof createPackageLifecycle>,
  options: { trustPath?: string; workspace?: RouteWorkspace; bridge?: RevitBridge["Service"] } = {},
) {
  const path = options.trustPath ?? productRouteTrustPath();
  const registrations = new Map<string, { hash: string; dispose: () => void }>();
  let closed = false;
  let tail = Promise.resolve();
  const decisions = () => readJson(path, trustSchema, {});
  let listing = Promise.resolve<PodRouteDescriptor[]>([]);
  function list(): Promise<PodRouteDescriptor[]> {
    const next = listing.then(readList, readList);
    listing = next;
    return next;
  }
  function current(key: string, fingerprint: string) {
    return lifecycle
      .packages()
      .some(
        (pod) =>
          !pod.diagnostics.some((d) => d.code === "InvalidRoute") &&
          pod.routes?.some(
            (route) =>
              `route:@${pod.id}/${route.artifact}` === key && route.fingerprint === fingerprint,
          ),
      );
  }
  // Withdrawal releases the exact registration even when no client asks for inventory again.
  const stopChanges = lifecycle.observeChanges(() => {
    for (const [key, registration] of registrations) {
      if (!current(key, registration.hash)) {
        registration.dispose();
        registrations.delete(key);
      }
    }
  });
  async function readList(): Promise<PodRouteDescriptor[]> {
    await lifecycle.ready;
    if (closed) return [];
    const trust = await decisions();
    const descriptors = lifecycle.packages().flatMap((pod) => {
      if (pod.diagnostics.some((d) => d.code === "InvalidRoute")) return [];
      return (pod.routes ?? []).map((route) => {
        const key = `route:@${pod.id}/${route.artifact}`;
        return {
          ...route,
          key,
          packageId: pod.id,
          workRoute: `pod.${pod.id}.${route.artifact.split("/")[1]}`,
          fingerprint: route.fingerprint,
          trusted: trust[key] === route.fingerprint,
        };
      });
    });
    for (const [key, registration] of registrations) {
      if (
        !descriptors.some(
          (route) => route.key === key && route.trusted && route.fingerprint === registration.hash,
        )
      ) {
        registration.dispose();
        registrations.delete(key);
      }
    }
    for (const route of descriptors) {
      if (route.trusted && !registrations.has(route.key) && options.workspace) {
        const pod = lifecycle.packages().find((pod) => pod.id === route.packageId)!;
        const bytes = pod.members.find((member) => member.path === route.artifact)!.bytes;
        const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
        const admitted = await admitPodArtifact(value, route.fingerprint);
        if (
          admitted.data.key !== route.workRoute ||
          admitted.data.work?.route !== route.workRoute ||
          admitted.data.address !== `/tool/${encodeURIComponent(route.key)}`
        )
          throw Error("Admitted route identity differs from its package declaration");
        if (closed) return [];
        if (!current(route.key, route.fingerprint)) continue;
        const registration = registerAdmittedHostRoute(admitted, options.workspace);
        const dispose = registration.close;
        registrations.set(route.key, { hash: route.fingerprint, dispose });
      }
    }
    return descriptors;
  }
  return {
    list,
    async trust(key: string, hash: string, trusted: boolean) {
      const write = tail.then(async () => {
        const route = (await list()).find((route) => route.key === key);
        if (!route || route.fingerprint !== hash)
          throw Error("Route changed or is inactive; inspect its current bytes before trusting");
        const trust = await decisions();
        if (trusted) trust[key] = hash;
        else delete trust[key];
        await writeArtifact(dirname(path), path, JSON.stringify(trust), true);
      });
      tail = write.catch((error) => {
        console.error("pod-routes: asynchronous operation failed", error);
      });
      await write;
      return list();
    },
    async bundle(key: string, hash: string) {
      const route = (await list()).find((route) => route.key === key);
      if (!route || route.fingerprint !== hash || !route.trusted)
        throw Error("Route trust is absent or its bytes changed");
      const pod = lifecycle.packages().find((pod) => pod.id === route.packageId)!;
      const member = pod.members.find((member) => member.path === route.artifact)!;
      const { wire } = await verifyPodArtifact(
        JSON.parse(Buffer.from(member.bytes).toString("utf8")),
        route.fingerprint,
      );
      // ponytail: JSON number arrays inflate payload roughly 3?4x; move to base64 or a raw octet-stream if Pod artifacts grow.
      return { fingerprint: route.fingerprint, artifact: wire };
    },
    close() {
      closed = true;
      stopChanges();
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
    },
  };
}
