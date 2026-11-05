import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import {
  discoveryMachine,
  capabilityPrincipals,
  commands,
  capabilityRecentSchema,
  type Machine,
  type Capability,
  type CapabilityCatalog,
  type CapabilityRecent,
  type RouteStateSpec,
  type AdmittedView,
  type PackageProjection,
} from "@pe/agent-contracts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { contextFetch as fetch } from "@pe/runtime/context";
import { z } from "zod";
import { opRow, dynamicCapabilityProvider, podCapabilities } from "./capability-projections.ts";
export { dynamicCapabilityProvider } from "./capability-projections.ts";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import {
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
} from "@pe/host-contracts/operation-types";
import type { SkillSnapshot } from "./skill-publication.ts";
import type { RouteRegistration } from "./routes.ts";

type OpsCatalogEntry = HostOperationDefinition & {
  principal?: readonly import("@pe/agent-contracts").Principal[];
};

export interface CapabilitySources {
  ops: readonly OpsCatalogEntry[];
  availabilityKnown?: boolean;
  routes: readonly RouteStateSpec<z.ZodType>[];
  packages: readonly PackageProjection[];
  skills: readonly SkillSnapshot[];
  pages?: readonly Capability[];
  /** Agent policy of an admitted route's fields (the host workspace's admission), else null. */
  /** Live registrations from the workspace's admission owner; withdrawn routes are absent. */
  admittedRoutes?: () => readonly AdmittedView[];
}

/** Pure projection, ordered by compiled operations/routes, packaged content and scratch Pages. */
export function buildCapabilities(sources: CapabilitySources): Capability[] {
  const generated = new Map<string, OpsCatalogEntry>(
    hostOpCatalog.map((op) => [op.key, op as OpsCatalogEntry]),
  );
  for (const op of tsOnlyOperationCatalog) generated.set(op.key, op);
  const hidden = new Set(
    Object.values(commands).flatMap(
      (command) => (command as import("@pe/agent-contracts").Command).native ?? [],
    ),
  );
  return [
    ...[...generated.values()]
      .filter((op) => !op.internal && !hidden.has(op.key) && !Object.hasOwn(commands, op.key))
      .map((op) => ({
        ...opRow(op),
        availability: {
          state:
            isTsOnlyOperationKey(op.key) || sources.ops.some((live) => live.key === op.key)
              ? ("available" as const)
              : sources.availabilityKnown
                ? ("unavailable" as const)
                : ("unknown" as const),
        },
      })),
    ...[...linkedCatalog().entries.values()].flatMap((entry): Capability[] => {
      const row = entry.discovery;
      if (!row) return [];
      return [
        {
          ...row,
          kind: row.key.startsWith("route:") ? "route-command" : "op",
          needs: row.needs as Capability["needs"],
          effect: row.effect === "command" ? "command" : "query",
          mutates: row.effect === "command",
          principal: row.principal ? [...row.principal] : capabilityPrincipals(false),
          finds: row.finds ? [...row.finds] : undefined,
          source: "catalog",
          rank: 2,
        },
      ];
    }),
    ...dynamicCapabilityProvider(sources),
  ];
}

const CATALOG_TTL_MS = 30_000;
// SDK resolution allows 30 s before native catalog dispatch; host-only sources keep their 2 s budget.
const NATIVE_CATALOG_BUDGET_MS = 60_000;

export interface CapabilityCatalogSource {
  /** The catalog for an SDK selection or an exact private attachment. */
  read(scope?: HostSessionScope): Promise<CapabilityCatalog>;
  /** Drop every cached catalog; the host calls this when a Revit session connects or leaves. */
  invalidate(): void;
}

export type CapabilityContent = Pick<CapabilitySources, "packages" | "skills" | "pages"> & {
  diagnostics: CapabilityCatalog["diagnostics"];
  sourceDiagnostics?: string[];
};

/** Native metadata is scoped; every scope shares the same admitted content snapshot. */
export function createCapabilityCatalogSource(options: {
  hostBaseUrl: string;
  registrations: readonly RouteRegistration[];
  machine: () => Promise<Machine>;
  content?: () => Promise<CapabilityContent>;
  /** Scratch Pages read fresh on every catalog read, whatever the cached snapshot holds. */
  pages?: () => Promise<readonly Capability[]>;
  admittedRoutes?: CapabilitySources["admittedRoutes"];
}): CapabilityCatalogSource {
  const base = options.hostBaseUrl.replace(/\/$/, "");
  const routes = options.registrations.map((registration) => registration.spec);
  const cache = new Map<string, { at: number; catalog: Omit<CapabilityCatalog, "machine"> }>();
  const recents = recentsSource(base);
  return {
    invalidate: () => cache.clear(),
    // Recents are the machine's, not the scope's: one source, its own cache and budget.
    read: async (scope = {}) => {
      const [scoped, recent, machine, pages] = await Promise.all([
        readScoped(scope),
        recents(),
        options.machine(),
        options.pages?.().catch((error) => { console.error("capabilities: asynchronous operation failed", error); return undefined; }),
      ]);
      const catalog = pages
        ? {
            ...scoped,
            capabilities: [
              ...scoped.capabilities.filter(
                (row) => !(row.kind === "page" && row.package?.id === "pages"),
              ),
              ...pages,
            ],
          }
        : scoped;
      return {
        ...catalog,
        capabilities: [
          ...catalog.capabilities.filter(
            (row) => !podCapabilities().some((pod) => pod.key === row.key),
          ),
          ...podCapabilities(),
        ],
        machine: discoveryMachine(machine),
        recents: recent.recents,
        sources: { ...catalog.sources, recents: recent.status },
      };
    },
  };

  async function readScoped(scope: HostSessionScope): Promise<Omit<CapabilityCatalog, "machine">> {
    // Live registrations key the cache, so a trusted, replaced or withdrawn route is never served stale.
    const cacheKey = JSON.stringify([scope, options.admittedRoutes?.() ?? []]);
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.catalog;

    const sources: Record<string, string> = { "route registry": "ok", skills: "ok" };
    const [ops, admitted] = await Promise.allSettled([
      fetchOps(base, scope),
      options.content?.() ??
        Promise.resolve<CapabilityContent>({ packages: [], skills: [], diagnostics: [] }),
    ]);
    const opsValue =
      ops.status === "fulfilled"
        ? ops.value
        : { operations: [...tsOnlyOperationCatalog] as OpsCatalogEntry[] };
    sources.catalog =
      ops.status === "rejected"
        ? `did not answer: ${message(ops.reason)}`
        : opsValue.bridgeCatalogError
          ? `bridge catalog unavailable: ${opsValue.bridgeCatalogError}`
          : "ok";
    sources.packages = sources.skills =
      admitted.status === "rejected"
        ? `did not answer: ${message(admitted.reason)}`
        : admitted.value.sourceDiagnostics?.join("; ") || "ok";
    const catalog: Omit<CapabilityCatalog, "machine"> = {
      at: new Date().toISOString(),
      bridgeSessionId: opsValue.bridgeSessionId,
      sources,
      diagnostics: admitted.status === "fulfilled" ? admitted.value.diagnostics : [],
      capabilities: buildCapabilities({
        ops: opsValue.operations ?? [],
        availabilityKnown: ops.status === "fulfilled" && !opsValue.bridgeCatalogError,
        routes,
        admittedRoutes: options.admittedRoutes,
        ...(admitted.status === "fulfilled" ? admitted.value : { packages: [], skills: [] }),
      }),
    };
    cache.clear();
    cache.set(cacheKey, { at: Date.now(), catalog });
    return catalog;
  }
}

// Recents change when a person opens a file in Revit: minutes, not seconds.
const RECENTS_TTL_MS = 5 * 60_000;
// The catalog waits this long for them, then answers without; the read finishes for the next one.
const RECENTS_BUDGET_MS = 2_000;
// The host relays `pe-revit doc list --recent` (about 1 s; it reads each file's saved year).
const RECENTS_READ_MS = 65_000;

type Recents = { recents: CapabilityRecent[]; status: string };

/** Revit's recent documents through the host's own SDK reading. A failure is a `sources` entry. */
function recentsSource(base: string): () => Promise<Recents> {
  let entry: { until: number; answer: Promise<Recents> } | undefined;
  return () => {
    if (!entry || Date.now() > entry.until) {
      const answer: Promise<Recents> = fetchRecents(base).then(
        (recents) => ({ recents, status: "ok" }),
        (error) => {
          // A failed read retries on the catalog's cadence, not the recents'.
          if (entry?.answer === answer) entry.until = Date.now() + CATALOG_TTL_MS;
          return { recents: [], status: `did not answer: ${message(error)}` };
        },
      );
      entry = { until: Date.now() + RECENTS_TTL_MS, answer };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Recents>((resolve) => {
      timer = setTimeout(
        () => resolve({ recents: [], status: `still reading after ${RECENTS_BUDGET_MS} ms` }),
        RECENTS_BUDGET_MS,
      );
    });
    return Promise.race([entry.answer, late]).finally(() => clearTimeout(timer));
  };
}

async function fetchRecents(base: string): Promise<CapabilityRecent[]> {
  const response = await fetch(`${base}/instances/readings?read=recents`, {
    signal: AbortSignal.timeout(RECENTS_READ_MS),
  });
  if (!response.ok) throw new Error(`GET ${base}/instances/readings answered ${response.status}`);
  // The SDK envelope; `result.recents` is absent when no Revit year has a recent list.
  const envelope = (await response.json()) as { result?: { recents?: unknown } };
  return z.array(capabilityRecentSchema).parse(envelope.result?.recents ?? []);
}

async function fetchOps(base: string, scope: HostSessionScope) {
  const headers: Record<string, string> = {};
  if (scope.bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = scope.bridgeSessionId;
  if (scope.session) headers[HOST_RPC_SDK_SESSION_HEADER] = JSON.stringify(scope.session);
  const response = await fetch(`${base}/ops`, {
    headers,
    signal: AbortSignal.timeout(NATIVE_CATALOG_BUDGET_MS),
  });
  if (!response.ok) throw new Error(`GET ${base}/ops answered ${response.status}`);
  return (await response.json()) as {
    operations?: OpsCatalogEntry[];
    bridgeSessionId?: string;
    bridgeCatalogError?: string;
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
