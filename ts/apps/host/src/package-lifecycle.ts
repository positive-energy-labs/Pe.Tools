import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createPluginRuntime, type PluginContext } from "@pe/agent-contracts";
import { z } from "zod";
import { listPackages, type AdmittedPackage } from "./packages.ts";
import { readJson, writeArtifact } from "./page-artifacts.ts";
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
/** Import is the explicit activation action. Bootstrap imports join the initial census instead. */
export async function activateImportedPackage(id: string, podsRoot: string) {
  if (podsRoot !== productPodsRootPath() || !serving?.initialized()) return;
  await serving.refresh();
  await serving.setEnabled(`pod:${id}`, true);
}
const readDecisions = (path: string) => readJson(path, decisionsSchema, {});
/** Runtime policy only. Membership and export remain exact authored bytes. */
export async function requirePackageEnabled(id: string, podsRoot = productPodsRootPath()) {
  if (podsRoot !== productPodsRootPath()) return;
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
  podsRoot = productPodsRootPath(),
) {
  const enabled = await Promise.allSettled(
    packages.map((pod) => requirePackageEnabled(pod.id, podsRoot)),
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
  const runtime = createPluginRuntime<Contribution>({
    changed: options.changed,
    persist: async (id, enabled) => {
      const next = { ...decisions, [id]: enabled };
      await writeArtifact(dirname(decisionsPath), decisionsPath, JSON.stringify(next), true);
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
    return listing;
  }
  return {
    ready,
    initialized: () => initialized,
    /** The first catalog build reuses the bootstrap census; every later read re-lists. */
    refresh: async (initial = false) => {
      await ready;
      const listing = initial ? initialListing : undefined;
      initialListing = undefined;
      return listing ?? synchronize();
    },
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
    },
  };
}
