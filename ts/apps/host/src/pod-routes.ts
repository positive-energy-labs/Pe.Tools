import { stateSegments } from "@pe/host-contracts/service-identity";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { AdmittedPackage } from "./packages.ts";
import type { RevitBridge } from "./bridge.ts";
import * as contracts from "@pe/agent-contracts";
import { z } from "zod";
import { type PodRouteDescriptor } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { HostAdmittedRoute } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import type { createPackageLifecycle } from "./package-lifecycle.ts";
import {
  read as readFile,
  writeState,
  keptStateKind,
  type StateRoot,
} from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
import { admitPodArtifact, loadPodHostEntry, verifyPodArtifact } from "./pod-artifact.ts";
import { registeredReads, routeDeclarationRead } from "./reads/routes.ts";
import { RouteGraphWire } from "../../../packages/agent-contracts/src/route-kernel-data.ts";

/** Builtin source admission and verified Pod-byte admission share this host-owned door.
 * The caller supplies the exact authenticated handle, never a browser schema or migration. */
export function registerAdmittedHostRoute(
  route: contracts.AdmittedRoute | HostAdmittedRoute,
  workspace: RouteWorkspace,
  host?: Pick<contracts.HostRouteModule, "reads" | "leaves">,
): ReturnType<RouteWorkspace["registerAdmitted"]> {
  // Builtins joined the same registry at startup. A verified Pod owns its runtime entries.
  const captured = route.workFingerprint.startsWith("pod-bytes:")
    ? contracts.captureAdmittedHostBindings(route)
    : undefined;
  let unregister = () => {};
  try {
    if (captured) {
      const bindings = host ?? captured.bindings;
      unregister = registeredReads.register(
        {
          ...("reads" in bindings ? bindings.reads : {}),
          [`route:${route.data.key}`]: routeDeclarationRead({
            data: RouteGraphWire.parse(route.data),
            schemas: captured.bindings.schemas,
          }),
        },
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

export const trustKind = keptStateKind({
  schema: trustSchema,
  place: () => "Pod route trust",
  segments: () => stateSegments("routeTrust"),
});

// A healthy 16 MB Snowdon check took 1171 ms locally: background census validation of
// numeric byte arrays delays both file callbacks and timers on this same event loop.
// Round four times that observed elapsed time up to whole seconds. Google Drive is not measured.
const POD_ROUTE_CHECK_TIMEOUT_MS = 5000;

/** Transient source IO failure: a caller may retry without changing its trust choice. */
export class PodRouteCheckTimeout extends Error {
  readonly code = "pod.route.check.timeout";
  readonly retryable = true;
  constructor() {
    super(
      `Pod route byte check exceeded ${POD_ROUTE_CHECK_TIMEOUT_MS} ms; retry when the home is available.`,
    );
    this.name = "PodRouteCheckTimeout";
  }
}

/** Trusted browser extensions have the shell's authority. Trust is local, explicit and content-pinned. */
export function createPodRoutes(
  lifecycle: ReturnType<typeof createPackageLifecycle>,
  options: {
    machine?: StateRoot;
    workspace?: RouteWorkspace;
    bridge?: RevitBridge["Service"];
  } = {},
) {
  const file = trustKind.in(options.machine ?? hostState());
  const registrations = new Map<string, { hash: string; dispose: () => void }>();
  const refusals = new Map<string, {
    bytes: string;
    admission: Extract<PodRouteDescriptor["admission"], { status: "refused" }>;
  }>();
  const cancelChecks = new Set<() => void>();
  async function currentArtifact(
    pod: AdmittedPackage,
    route: PodRouteDescriptor,
  ): Promise<unknown> {
    if (closed) throw Error("Pod routes are closed");
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const withinDeadline = () => {
      if (expired) throw new PodRouteCheckTimeout();
    };
    async function memberBytes(path: string): Promise<Buffer> {
      withinDeadline();
      const member = pod.members.find((member) => member.path === path);
      if (!member) throw Error("Pod route member is absent");
      const file = await open(join(pod.directory, path), "r");
      try {
        withinDeadline();
        const facts = await file.stat();
        withinDeadline();
        if (!facts.isFile() || facts.size !== member.bytes.length)
          throw Error("Pod route member changed size or kind");
        const bytes = Buffer.alloc(member.bytes.length + 1);
        let count = 0;
        while (count < bytes.length) {
          const read = await file.read(bytes, count, bytes.length - count, null);
          withinDeadline();
          if (!read.bytesRead) break;
          count += read.bytesRead;
        }
        if (count !== member.bytes.length || !bytes.subarray(0, count).equals(member.bytes))
          throw Error("Pod route bytes changed; inspect the current Pod before admission");
        return bytes.subarray(0, count);
      } finally {
        // An OS call cannot always be cancelled. A late open still closes its handle, but the
        // request's deadline does not wait for that cleanup or allow later admission.
        await file.close();
      }
    }
    async function check(): Promise<unknown> {
      await memberBytes("pod.json");
      const bytes = await memberBytes(route.artifact);
      // Confirm the declaration after reading the artifact. Filesystem checks across two paths
      // are not atomic: either path can change after this final observation. Only checked bytes
      // are delivered; no cached bytes gain authority from this remaining filesystem window.
      await memberBytes("pod.json");
      withinDeadline();
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      return value;
    }
    let cancel = () => {};
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => {
        expired = true;
        clearTimeout(timer);
        reject(Error("Pod routes are closed"));
      };
      cancelChecks.add(cancel);
      timer = setTimeout(() => {
        expired = true;
        reject(new PodRouteCheckTimeout());
      }, POD_ROUTE_CHECK_TIMEOUT_MS);
    });
    try {
      return await Promise.race([check(), deadline]);
    } catch (error) {
      registrations.get(route.key)?.dispose();
      registrations.delete(route.key);
      throw error;
    } finally {
      cancelChecks.delete(cancel);
      clearTimeout(timer);
    }
  }
  let closed = false;
  let tail = Promise.resolve();
  // A person's trust decisions, so `keep` (MAP decision log 92bdf2df names `route-trust.json`). A
  // file that does not decode is refused with a notice and its bytes stay. Every route reads as
  // untrusted, and no decision is saved over it until a person fixes or removes the file.
  const stored = () => readFile(file);
  const decisions = async () => {
    const read = stored();
    return read.kind === "ok" ? read.value : {};
  };
  const admitting = new Set<string>();
  const capturedBytes = (pod: AdmittedPackage) => JSON.stringify([
    pod.directory, pod.members.map(member => [member.path, member.sha256]),
  ]);
  function refuse(admission: Extract<PodRouteDescriptor["admission"], { status: "refused" }>): never {
    if (admission.code === "pod.route.check.timeout") throw new PodRouteCheckTimeout();
    throw Error(admission.reason);
  }
  // An admission belongs to its initiating request, never a shared inventory queue.
  const list = () => readList();
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
    lifecycle.requestRefresh();
    const trust = await decisions();
    const pods = lifecycle.packages();
    const descriptors: PodRouteDescriptor[] = pods.flatMap((pod) => {
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
          admission: { status: trust[key] === route.fingerprint ? "pending" : "untrusted" },
        };
      });
    });
    for (const key of refusals.keys())
      if (!descriptors.some(route => route.key === key)) refusals.delete(key);
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
      const pod = pods.find(pod => pod.id === route.packageId)!;
      const bytes = capturedBytes(pod);
      const refused = refusals.get(route.key);
      // A refusal is evidence about this captured census and trust choice, never authority.
      // Even a non-route member edit retries admission; an unchanged census never does.
      if (refused && (!route.trusted || refused.bytes !== bytes)) refusals.delete(route.key);
      const cached = refusals.get(route.key);
      if (cached) {
        route.admission = cached.admission;
        continue;
      }
      if (registrations.has(route.key)) route.admission = { status: "admitted" };
      if (
        route.trusted &&
        !registrations.has(route.key) &&
        !admitting.has(route.key) &&
        options.workspace
      ) {
        admitting.add(route.key);
        let checked = false;
        try {
          const value = await currentArtifact(pod, route);
          checked = true;
          const evidence = await verifyPodArtifact(value, route.fingerprint);
          const host = evidence.executables.some((entry) => entry.client === "host")
            ? await loadPodHostEntry(value, route.fingerprint)
            : undefined;
          const admitted = await admitPodArtifact(value, route.fingerprint);
          if (
            admitted.data.key !== route.workRoute ||
            admitted.data.work?.route !== route.workRoute ||
            admitted.data.address !== `/tool/${encodeURIComponent(route.key)}`
          )
            throw Error("Admitted route identity differs from its package declaration");
          if (closed) return [];
          if (!current(route.key, route.fingerprint)) continue;
          if ((await decisions())[route.key] !== route.fingerprint) continue;
          const registration = registerAdmittedHostRoute(admitted, options.workspace, host);
          const dispose = registration.close;
          registrations.set(route.key, { hash: route.fingerprint, dispose });
          route.admission = { status: "admitted" };
        } catch (error) {
          if (closed) return [];
          const timeout = error instanceof PodRouteCheckTimeout;
          const admission: Extract<PodRouteDescriptor["admission"], { status: "refused" }> = {
            status: "refused",
            code: timeout ? error.code : "pod.route.admission.refused",
            reason: contracts.message(error),
            retryable: timeout,
          };
          // Only matching fresh bytes can pin a refusal to this census. A failed check says
          // nothing about those captured bytes after a repair; deadlines stay request-local too.
          if (checked) refusals.set(route.key, { bytes, admission });
          route.admission = admission;
        } finally {
          admitting.delete(route.key);
        }
      }
    }
    return descriptors;
  }
  return {
    list,
    async trust(key: string, hash: string, trusted: boolean) {
      const write = tail.then(async () => {
        const read = stored();
        if (read.kind === "kept")
          throw Error(
            `Pod route trust can't be read, so the file is kept and this decision is not saved: ${read.reason}`,
          );
        const route = (await list()).find((route) => route.key === key);
        if (!route || route.fingerprint !== hash)
          throw Error("Route changed or is inactive; inspect its current bytes before trusting");
        const trust = read.kind === "ok" ? read.value : {};
        if (trusted) {
          const pod = lifecycle.packages().find((pod) => pod.id === route.packageId);
          if (!pod) throw Error("Pod is inactive");
          await currentArtifact(pod, route);
          trust[key] = hash;
        } else delete trust[key];
        if (closed) throw Error("Pod routes are closed");
        writeState(file, JSON.stringify(trust));
      });
      tail = write.catch((error) => {
        console.error("pod-routes: asynchronous operation failed", error);
      });
      await write;
      const rows = await list();
      const route = rows.find(route => route.key === key);
      if (trusted && route?.admission.status === "refused") refuse(route.admission);
      return rows;
    },
    async bundle(key: string, hash: string) {
      const route = (await list()).find((route) => route.key === key);
      if (!route || route.fingerprint !== hash || !route.trusted)
        throw Error("Route trust is absent or its bytes changed");
      if (route.admission.status === "refused") refuse(route.admission);
      // An in-flight admission is not authority. Refuse now so this reader never joins it.
      if (route.admission.status !== "admitted")
        throw Error("Pod route admission is pending; retry after it completes");
      const pod = lifecycle.packages().find((pod) => pod.id === route.packageId)!;
      const { wire } = await verifyPodArtifact(
        await currentArtifact(pod, route),
        route.fingerprint,
      );
      // ponytail: JSON number arrays inflate payload roughly 3?4x; move to base64 or a raw octet-stream if Pod artifacts grow.
      if (closed) throw Error("Pod routes are closed");
      // Byte verification yields: withdrawal or reconciliation may have ended this admission.
      const decision = stored();
      if (decision.kind !== "ok" || decision.value[key] !== hash ||
          registrations.get(key)?.hash !== hash || !current(key, hash))
        throw Error("Pod route admission changed; inspect it before delivery");
      return { fingerprint: route.fingerprint, artifact: wire };
    },
    close() {
      closed = true;
      for (const cancel of cancelChecks) cancel();
      cancelChecks.clear();
      admitting.clear();
      stopChanges();
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
      refusals.clear();
    },
  };
}
