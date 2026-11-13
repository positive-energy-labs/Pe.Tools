import { stateSegments } from "@pe/host-contracts/service-identity";
import { createHash } from "node:crypto";
import { createPluginRuntime } from "@pe/agent-contracts";
import { z } from "zod";
import {
  listPackages,
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
/** Import is the explicit activation action, including imports concurrent with the initial census. */
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
const storedDecisions = (file: DecisionsFile) =>
  readFile(file);
const readDecisions = async (file: DecisionsFile) => {
  const read = storedDecisions(file);
  return read.kind === "ok" ? read.value : {};
};
/**
 * Ids of the Pods in the project home a target document's pointer names. The start census has no
 * document, so these are outside it: only a person's off choice gates one.
 */
export const projectPodIds = async (pointer: string | null | undefined) => {
  const root = projectPodsRoot(pointer);
  return root ? (await listPackages(root)).packages.map((pod) => pod.id) : [];
};
/** Runtime policy only. Membership and export remain exact authored bytes. */
export async function requirePackageEnabled(
  id: string,
  podsRoots: PodsRoots = productPodsRoots(),
  outsideCensus: readonly string[] = [],
) {
  // Only the product's Pods carry policy: the content homes, or the user's Pods an import writes.
  if (typeof podsRoots === "string" && podsRoots !== productPodsRootPath()) return;
  if (serving && !outsideCensus.includes(id)) {
    await serving.ready;
    if (!serving.active(id)) throw Error(`Pod '${id}' is inactive`);
  }
  if ((await readDecisions(decisionsKind.in(hostState())))[`pod:${id}`] === false)
    throw Error(`Pod '${id}' is disabled`);
}
/** Inactive scopes stay visible through plugin inventory, never through their doors. */
export async function activePackages(
  packages: readonly AdmittedPackage[],
  podsRoots: PodsRoots = productPodsRoots(),
  outsideCensus: readonly string[] = [],
) {
  const enabled = await Promise.allSettled(
    packages.map((pod) => requirePackageEnabled(pod.id, podsRoots, outsideCensus)),
  );
  return packages.filter((_, index) => enabled[index]!.status === "fulfilled");
}

export function createPackageLifecycle(
  options: {
    packages?: typeof listPackages;
    machine?: StateRoot;
    changed?: () => void;
  } = {},
) {
  const decisionsFile = decisionsKind.in(options.machine ?? hostState());
  let decisions: Record<string, boolean> = {};
  let initialized = false;
  const signatures = new Map<string, string>();
  let initialListing: Awaited<ReturnType<typeof listPackages>> | undefined;
  const listeners = new Set<() => void>();
  const changed = () => {
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
  const ready = initialize();
  let settled: Promise<unknown> = ready;
  async function initialize() {
    decisions = await readDecisions(decisionsFile);
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
    initialListing = await synchronize(true);
    initialized = true;
  }
  async function synchronize(initial = false) {
    const listing = await (options.packages ?? listPackages)();
    const current = new Set(listing.packages.map((p) => `pod:${p.id}`));
    for (const id of signatures.keys())
      if (!current.has(id)) {
        await runtime.remove(id);
        signatures.delete(id);
      }
    for (const pod of listing.packages) {
      const id = `pod:${pod.id}`;
      const signature = createHash("sha256")
        .update(JSON.stringify(pod.members.map((m) => [m.path, m.sha256])))
        .digest("hex");
      if (signatures.get(id) === signature) continue;
      const known = signatures.has(id);
      signatures.set(id, signature);
      await runtime.install(
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
        decisions[id] === true || ((initial || known) && decisions[id] !== false),
      );
    }
    initialListing = listing;
    return listing;
  }
  return {
    // Inventory readers join the current census, including bootstrap's pending reconciliation.
    get ready() { return settled; },
    observeChanges(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialized: () => initialized,
    /** Explicit import, activation and update reconcile setup/cleanup; inventory reads use listing. */
    refresh: (initial = false) => {
      const next = settled.catch(() => ready).then(() => {
        const listing = initial ? initialListing : undefined;
        return listing ?? synchronize();
      });
      settled = next;
      return next;
    },
    listing: () => initialListing!,
    inventory: runtime.inventory,
    active: (id: string) => runtime.active(`pod:${id}`),
    setEnabled: async (id: string, enabled: boolean) => {
      await ready;
      await runtime.setEnabled(id, enabled);
    },
    packages: () =>
      runtime.contributions().flatMap((c) => (c.kind === "package" ? [c.package] : [])),
    skills: () => runtime.contributions().flatMap((c) => (c.kind === "skill" ? [c.skill] : [])),
    close: async () => {
      await ready;
      await runtime.close();
      changed();
    },
  };
}
