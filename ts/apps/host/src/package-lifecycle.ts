import { stateSegments } from "@pe/host-contracts/service-identity";
import { createHash } from "node:crypto";
import { acquireContentRoots, contentRootsReady, contentRootsRefreshMs } from "./content-roots.ts";
import { createPluginRuntime } from "@pe/agent-contracts";
import { z } from "zod";
import {
  listPackages,
  logPackageDiscovery,
  productPodsRoots,
  projectPodsRoot,
  type AdmittedPackage,
  type PodsRoots,
} from "./packages.ts";
import {
  read as readFile,
  writeState,
  keptStateKind,
  type StateRoot,
  type StoredFile,
} from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
import { PackageDiscoveryExceeded, packageDiscoveryTimeoutMs } from "./pod-capture.ts";
import { productPodsRootPath } from "./product-paths.ts";
import {
  builtinPeaSkillSnapshots,
  type SkillSnapshot,
} from "../../../packages/mcps/src/pea/skill-publication.ts";

type Contribution =
  | { kind: "package"; package: AdmittedPackage }
  | { kind: "skill"; skill: SkillSnapshot };
const decisionsSchema = z.record(z.string(), z.boolean());
export const decisionsKind = keptStateKind({
  schema: decisionsSchema,
  place: () => "Pod on and off choices",
  segments: () => stateSegments("pluginDecisions"),
});
type DecisionsFile = StoredFile<z.infer<typeof decisionsSchema>, "state-kept">;
let serving: ReturnType<typeof createPackageLifecycle> | undefined;
export function bindPackageLifecycle(
  lifecycle: ReturnType<typeof createPackageLifecycle> | undefined,
) {
  serving = lifecycle;
}
/** Host-authored Pod changes reconcile before reporting success, including changes during startup. */
export async function reconcilePackageChanges() {
  const lifecycle = serving;
  if (!lifecycle) return;
  await lifecycle.refresh();
}

/** Import also records the person's explicit on choice. Ordinary writes preserve that choice. */
export async function activateImportedPackage(id: string, podsRoot: string) {
  const lifecycle = serving;
  if (podsRoot !== productPodsRootPath() || !lifecycle) return;
  await lifecycle.ready;
  await lifecycle.refresh();
  await lifecycle.setEnabled(`pod:${id}`, true);
}
/**
 * A person's choices, so `keep` (MAP decision log 92bdf2df names `plugins.json`). A file that does
 * not decode is refused with a notice and its bytes stay. Defaults hold, and no choice is saved
 * over it until a person fixes or removes the file.
 */
const storedDecisions = (file: DecisionsFile) => readFile(file);
const readDecisions = async (file: DecisionsFile) => {
  const read = storedDecisions(file);
  return read.kind === "ok" ? read.value : {};
};
/**
 * Ids of the Pods in the project home a target document's pointer names. The start census has no
 * document, so these are outside it: only a person's off choice gates one.
 */
export const projectPodIds = async (pointer: string | null | undefined) => {
  await contentRootsReady(pointer);
  const root = projectPodsRoot(pointer);
  return root ? (await listPackages({ podsRoots: root })).packages.map((pod) => pod.id) : [];
};

/** Runtime policy only. Membership and export remain exact authored bytes. */
export async function requirePackageEnabled(
  id: string,
  podsRoots?: PodsRoots,
  outsideCensus: readonly string[] = [],
) {
  // Only the product's Pods carry policy: the content homes, or the user's Pods an import writes.
  if (typeof podsRoots === "string" && podsRoots !== productPodsRootPath()) return;
  if (serving && !outsideCensus.includes(id)) {
    const lifecycle = serving;
    const discover = async () => {
      await lifecycle.ready;
      if (!lifecycle.inventory().some((pod) => pod.id === `pod:${id}`)) {
        // A new slug/key is usable before the inventory cadence sees it. Its admission
        // checks every manifest identity and only this Pod's members.
        await lifecycle.admit(id);
      } else lifecycle.requestRefresh();
      // Replacing a runtime scope briefly deactivates it. Wait for that Pod's installation,
      // within this request's existing budget, rather than turning an edit into a plain 404.
      await lifecycle.installation(id);
      if (!lifecycle.active(id)) throw Error(`Pod '${id}' is inactive`);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        discover(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new PackageDiscoveryExceeded(podsRoots ?? productPodsRoots())), packageDiscoveryTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  if ((await readDecisions(decisionsKind.in(hostState())))[`pod:${id}`] === false)
    throw Error(`Pod '${id}' is disabled`);
}
/** Inactive scopes stay visible through plugin inventory, never through their doors. */
export async function activePackages(
  packages: readonly AdmittedPackage[],
  podsRoots?: PodsRoots,
  outsideCensus: readonly string[] = [],
) {
  const enabled = await Promise.allSettled(
    packages.map((pod) => requirePackageEnabled(pod.id, podsRoots, outsideCensus)),
  );
  for (const result of enabled)
    if (result.status === "rejected" && result.reason instanceof PackageDiscoveryExceeded) throw result.reason;
  return packages.filter((_, index) => enabled[index]!.status === "fulfilled");
}

export function createPackageLifecycle(
  options: {
    packages?: typeof listPackages;
    machine?: StateRoot;
    changed?: () => void;
  } = {},
) {
  const rootsOwner = options.packages ? undefined : acquireContentRoots();
  let inFlight: Promise<Awaited<ReturnType<typeof listPackages>>> | undefined;
  let closed = false;
  const decisionsFile = decisionsKind.in(options.machine ?? hostState());
  let decisions: Record<string, boolean> = {};
  let initialized = false;
  const signatures = new Map<string, string>();
  const installations = new Map<string, Promise<void>>();
  let refreshedAt = Date.now();
  let initialListing: Awaited<ReturnType<typeof listPackages>> = { packages: [], unreadable: [] };
  const listeners = new Set<() => void>();
  const changed = () => {
    if (closed) return;
    options.changed?.();
    for (const listener of listeners) listener();
  };
  const runtime = createPluginRuntime<Contribution>({
    changed,
    persist: async (id, enabled) => {
      const stored = storedDecisions(decisionsFile);
      if (stored.kind === "kept")
        throw Error(
          `Pod on and off choices can't be read, so the file is kept and this choice is not saved: ${stored.reason}`,
        );
      const next = { ...decisions, [id]: enabled };
      writeState(decisionsFile, JSON.stringify(next));
      decisions = next;
    },
  });
  const ready = initialize().catch(error => {
    if (!closed) logPackageDiscovery(`Pod startup census failed; retry on refresh: ${String(error)}`);
  });
  let settled: Promise<unknown> = ready;
  async function initialize() {
    await rootsOwner?.ready;
    decisions = await readDecisions(decisionsFile);
    if (closed) return;
    await runtime.install(
      {
        id: "product:skills",
        setup(context) {
          for (const skill of builtinPeaSkillSnapshots())
            context.contribute(skill.key, { kind: "skill", skill });
        },
      },
      decisions["product:skills"] !== false,
    );
    initialListing = await synchronize();
    initialized = true;
  }
  async function synchronize(packageId?: string) {
    if (closed) return initialListing;
    if (packageId === undefined) refreshedAt = Date.now();
    // Roots are refreshed by the shared async owner, never by a request or scan.
    const roots = options.packages ? [] : productPodsRoots();
    // Lifecycle owns publication after a slow scan; Page requests bound their own wait for it.
    const listing = await (options.packages ? options.packages({ packageId }) : listPackages({ podsRoots: roots, wait: "background", packageId }));
    if (closed) return initialListing;
    const current = new Set(listing.packages.map((p) => `pod:${p.id}`));
    for (const id of signatures.keys())
      if (!current.has(id)) {
        await runtime.remove(id);
        signatures.delete(id);
      }
    for (const pod of listing.packages) {
      if (closed) return initialListing;
      const id = `pod:${pod.id}`;
      const signature = createHash("sha256")
        .update(
          JSON.stringify([
            pod.directory,
            pod.discoveryFailure,
            pod.diagnostics,
            pod.members.map((m) => [m.path, m.sha256]),
          ]),
        )
        .digest("hex");
      if (signatures.get(id) === signature) continue;
      signatures.set(id, signature);
      const installation = runtime.install(
        {
          id,
          setup(context) {
            const errors = pod.diagnostics.filter((d) =>
              ["PackageMemberInvalid", "DuplicatePodId"].includes(d.code),
            );
            if (errors.length) throw Error(errors.map((d) => d.message).join("; "));
            context.contribute(id, { kind: "package", package: pod });
          },
        },
        decisions[id] !== false,
      );
      installations.set(id, installation);
      try { await installation; }
      finally { if (installations.get(id) === installation) installations.delete(id); }
    }
    if (closed) return initialListing;
    initialListing = listing;
    return listing;
  }
  function refresh(initial = false) {
    if (inFlight) return inFlight;
    const next = settled
      .catch(() => ready)
      .then(() => {
        if (closed || initial) return initialListing;
        return synchronize();
      });
    inFlight = next;
    void next
      .finally(() => {
        if (inFlight === next) inFlight = undefined;
      })
      .catch(() => {});
    return next;
  }
  const requestRefresh = () => {
    if (closed || Date.now() - refreshedAt < contentRootsRefreshMs) return;
    return refresh().catch((error) => {
      if (!closed) console.error("package-lifecycle: background refresh failed; keeping last listing", error);
    });
  };
  // Whole inventory follows the roots cadence. Named requests validate their Pod's members
  // and all manifest identities independently; human/agent writes still await explicit refresh.
  const refreshTimer = setInterval(requestRefresh, contentRootsRefreshMs);
  refreshTimer.unref();
  return {
    // Only startup gates readers. Each action awaits its own refresh before reporting success;
    // unrelated readers serve the completed census even while that action scans a slow drive.
    get ready() {
      return ready;
    },
    observeChanges(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialized: () => initialized,
    /** One scan in flight. Reads serve the last completed listing until it finishes. */
    requestRefresh,
    installation: (id: string) => installations.get(`pod:${id}`),
    admit: (id: string) => synchronize(id),
    refresh: (initial = false) => {
      // An action may have written after discovery captured its bytes. Queue a fresh census
      // behind that scan rather than joining its stale snapshot. Background readers join neither.
      const next = (inFlight ?? settled)
        .catch(() => ready)
        .then(() => {
          if (closed || initial) return initialListing;
          return synchronize();
        });
      inFlight = next;
      void next
        .finally(() => {
          if (inFlight === next) inFlight = undefined;
        })
        .catch(() => {});
      settled = next;
      return next;
    },
    listing: () => initialListing,
    inventory: runtime.inventory,
    active: (id: string) => runtime.active(`pod:${id}`),
    setEnabled: async (id: string, enabled: boolean) => {
      await ready;
      if (closed) throw Error("Pod lifecycle is closed");
      await runtime.setEnabled(id, enabled);
    },
    packages: () =>
      runtime.contributions().flatMap((c) => (c.kind === "package" ? [c.package] : [])),
    skills: () => runtime.contributions().flatMap((c) => (c.kind === "skill" ? [c.skill] : [])),
    close: async () => {
      closed = true;
      clearInterval(refreshTimer);
      rootsOwner?.close();
      // The detached initial read may fail after its home has been released.
      void ready.catch(() => {});
      // Scans own only reads. A stalled filesystem must not hold shutdown; synchronize refuses
      // publication after its pending read returns. The data-only runtime has no filesystem hooks.
      await runtime.close();
      changed();
    },
  };
}
