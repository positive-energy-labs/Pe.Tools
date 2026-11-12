import { createHash } from "node:crypto";
import { createPluginRuntime, type PluginContext } from "@pe/agent-contracts";
import { z } from "zod";
import { listPackages, productPodsRoots, type AdmittedPackage, type PodsRoots } from "./packages.ts";
import { readStored, writeAtomic } from "@pe/host-contracts/store";
import { storedNoticesPath } from "./notice-feed.ts";
import { productPluginDecisionsPath, productPodsRootPath } from "./product-paths.ts";
import {
  builtinPeaSkillSnapshots,
  type SkillSnapshot,
} from "../../../packages/mcps/src/pea/skill-publication.ts";

type Contribution =
  | { kind: "package"; package: AdmittedPackage }
  | { kind: "skill"; skill: SkillSnapshot };
const decisionsSchema = z.record(z.string(), z.boolean());
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
const storedDecisions = (path: string) =>
  readStored(path, decisionsSchema, {
    class: "keep",
    place: "Pod on and off choices",
    notices: storedNoticesPath(),
  });
const readDecisions = async (path: string) => {
  const read = storedDecisions(path);
  return read.kind === "ok" ? read.value : {};
};
/** Runtime policy only. Membership and export remain exact authored bytes. */
export async function requirePackageEnabled(id: string, podsRoots: PodsRoots = productPodsRoots()) {
  // Only the product's Pods carry policy: the content homes, or the user's Pods an import writes.
  if (typeof podsRoots === "string" && podsRoots !== productPodsRootPath()) return;
  if (serving) {
    await serving.ready;
    if (!serving.active(id)) throw Error(`Pod '${id}' is inactive`);
  }
  if ((await readDecisions(productPluginDecisionsPath()))[`pod:${id}`] === false)
    throw Error(`Pod '${id}' is disabled`);
}
/** Inactive scopes stay visible through plugin inventory, never through their doors. */
export async function activePackages(
  packages: readonly AdmittedPackage[],
  podsRoots: PodsRoots = productPodsRoots(),
) {
  const enabled = await Promise.allSettled(
    packages.map((pod) => requirePackageEnabled(pod.id, podsRoots)),
  );
  return packages.filter((_, index) => enabled[index]!.status === "fulfilled");
}

export function createPackageLifecycle(
  options: {
    packages?: typeof listPackages;
    decisionsPath?: string;
    changed?: () => void;
  } = {},
) {
  const decisionsPath = options.decisionsPath ?? productPluginDecisionsPath();
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
      const stored = storedDecisions(decisionsPath);
      if (stored.kind === "kept")
        throw Error(
          `Pod on and off choices can't be read, so the file is kept and this choice is not saved: ${stored.reason}`,
        );
      const next = { ...decisions, [id]: enabled };
      writeAtomic(decisionsPath, JSON.stringify(next));
      decisions = next;
    },
  });
  const ready = initialize();
  async function initialize() {
    decisions = await readDecisions(decisionsPath);
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
          async setup(context) {
            const errors = pod.diagnostics.filter((d) =>
              ["PackageMemberInvalid", "DuplicatePodId"].includes(d.code),
            );
            if (errors.length) throw Error(errors.map((d) => d.message).join("; "));
            context.contribute(id, { kind: "package", package: pod });
            const cleanups: (() => void | Promise<void>)[] = [];
            try {
              for (const member of pod.members.filter((m) =>
                /^plugins\/[^/]+\/index\.js$/.test(m.path),
              )) {
                // This is trusted local host code, not a sandbox. Import the captured version, never reread disk.
                const module = await import(
                  `data:text/javascript;base64,${Buffer.from(member.bytes).toString("base64")}#${member.sha256}`
                );
                if (typeof module.default?.setup !== "function")
                  throw Error(`${member.path} must export a plugin with setup`);
                const hooksOnly: PluginContext<never> = {
                  id,
                  hook: (name, observer) => context.hook(name, observer),
                  contribute() {
                    throw Error("Pod contributions follow admitted paths");
                  },
                };
                const cleanup = await module.default.setup(Object.freeze(hooksOnly));
                if (cleanup !== undefined && typeof cleanup !== "function")
                  throw Error(`${member.path} returned invalid cleanup`);
                if (cleanup) cleanups.push(cleanup);
              }
            } catch (error) {
              for (const cleanup of cleanups.reverse()) await cleanup();
              throw error;
            }
            return async () => {
              for (const cleanup of cleanups.reverse()) await cleanup();
            };
          },
        },
        decisions[id] === true || ((initial || known) && decisions[id] !== false),
      );
    }
    initialListing = listing;
    return listing;
  }
  return {
    ready,
    observeChanges(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialized: () => initialized,
    /** Explicit import, activation and update reconcile setup/cleanup; inventory reads use listing. */
    refresh: async (initial = false) => {
      await ready;
      const listing = initial ? initialListing : undefined;
      return listing ?? synchronize();
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
    emit: runtime.emit,
    close: async () => {
      await ready;
      await runtime.close();
      changed();
    },
  };
}
