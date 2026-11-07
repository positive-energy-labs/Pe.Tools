import { z } from "zod";
import { canonicalRouteJson } from "../../../../packages/agent-contracts/src/route-graph.ts";
import {
  createRouteAdmission,
  routeFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { CatalogLink } from "../../../../packages/agent-contracts/src/catalog.ts";

/** React and the shell's runtime must keep their singleton identities across lazy routes.
 * These are the ONLY permitted externals. Everything else belongs in the emitted closure.
 * A version alone is not evidence: each pin carries the exact shared deployment bytes.
 * The trusted shell supplies the already-loaded namespace for those bytes. It must never
 * re-evaluate React, Effect or kit contexts in a route-local copy. Workspace 0.0.0 packages
 * remain distinguished by their content hash. No function stringification or source hash.
 */
export const routeSharedSpecifiers = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "zod",
  "effect",
  "@effect/atom-react",
  "@pe/agent-contracts",
  "@pe/runtime",
  "@pe/kit",
] as const;
export interface SharedRouteModule {
  readonly specifier: (typeof routeSharedSpecifiers)[number];
  readonly version: string;
  readonly bytes: Uint8Array;
}
export function sharedContractId(module: SharedRouteModule): string {
  if (!routeSharedSpecifiers.includes(module.specifier) || !/^[\w.+-]+$/.test(module.version))
    throw Error("Unpinned or unsupported shared route module");
  return `shared:${module.specifier}@${module.version}`;
}

export interface RouteArtifactBytes {
  readonly artifact: RouteFingerprintInput;
  readonly fingerprint: string;
  readonly contracts: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly executables: readonly {
    readonly client: "web" | "pea" | "shared";
    readonly entry: string;
    readonly resolved: boolean;
    readonly members: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  }[];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Verify BEFORE evaluation, then give A the exports from those exact bytes. A loader is
 * trusted code, not a sandbox. This door never publishes or registers a refused module. */
// Pod discovery uses this byte verifier; builtin routes use build-owned source closures.
export async function verifyRouteArtifact(
  input: RouteArtifactBytes,
  catalog: readonly CatalogLink[],
  evaluate: (bytes: Uint8Array) => Promise<unknown>,
  shared: readonly (SharedRouteModule & { readonly namespace: object })[] = [],
) {
  // Own every mutable byte and pin before the first await (including the expected hash).
  const artifact = structuredClone(input.artifact);
  const expectedFingerprint = input.fingerprint;
  const contracts = input.contracts.map((item) => ({ ...item, bytes: new Uint8Array(item.bytes) }));
  const executables = input.executables.map((item) => ({
    ...item,
    members: item.members.map((member) => ({ ...member, bytes: new Uint8Array(member.bytes) })),
  }));
  const pins = shared.map((item) => ({
    ...item,
    bytes: new Uint8Array(item.bytes),
    namespace: Object.freeze({ ...item.namespace }),
  }));
  const linkedCatalog = catalog.map((entry) => ({
    ...entry,
    touches: [...entry.touches],
    uses: entry.uses.map((use) => (typeof use === "string" ? use : { ...use })),
  }));
  if (new Set(pins.map((pin) => pin.specifier)).size !== pins.length)
    throw Error("Duplicate shared route module");
  const requiredPins = contracts.filter((item) => item.id.startsWith("shared:"));
  if (requiredPins.length !== pins.length)
    throw Error("Shared route runtime differs from artifact");
  for (const pin of pins) {
    const contract = requiredPins.find((item) => item.id === sharedContractId(pin));
    if (!contract || (await sha256(contract.bytes)) !== (await sha256(pin.bytes)))
      throw Error("Shared route runtime differs from artifact");
  }
  if (executables.some((item) => !item.resolved)) throw Error("Unresolved route artifact");
  const actual: RouteFingerprintInput = {
    version: 1,
    data: artifact.data,
    contracts: await Promise.all(
      contracts.map(async (item) => ({ id: item.id, sha256: await sha256(item.bytes) })),
    ),
    executables: await Promise.all(
      executables.map(async (item) => ({
        client: item.client,
        entry: item.entry,
        members: await Promise.all(
          item.members.map(async (member) => ({
            path: member.path,
            sha256: await sha256(member.bytes),
          })),
        ),
      })),
    ),
  };
  const [declared, verified] = await Promise.all([
    routeFingerprint(artifact),
    routeFingerprint(actual),
  ]);
  if (declared !== expectedFingerprint || verified !== declared)
    throw Error("Route artifact bytes or fingerprint differ");
  const web = executables.filter((item) => item.client === "web");
  // The producer closes local imports into one JS member. Loading extra assets or chunks
  // would require a URL resolver that also verifies them; refuse instead of trusting URLs.
  if (web.length !== 1 || web[0]!.members.length !== 1 || web[0]!.entry !== "route.js")
    throw Error("Expected one closed web route.js artifact");
  const entry = web[0]!.members.find((member) => member.path === "route.js");
  if (!entry) throw Error("Missing route.js artifact");
  // The existing browser/Pod import owner supplies evaluation and owns URL cleanup.
  // Do not add a second unchecked dynamic-import door beside that owner.
  const exports = await evaluate(new Uint8Array(entry.bytes));
  let loaded = exports;
  if (pins.length) {
    const factory=z.object({instantiate:z.unknown()}).parse(exports);
    if(typeof factory.instantiate !== "function") throw Error("Expected a pinned module factory");
    loaded=factory.instantiate(Object.freeze(Object.fromEntries(pins.map(pin=>[pin.specifier,pin.namespace]))));
  }
  const { module } = z
    .object({ module: z.object({ data: z.unknown() }).passthrough() })
    .parse(loaded);
  if (canonicalRouteJson(module.data) !== canonicalRouteJson(artifact.data))
    throw Error("Loaded graph differs from artifact");
  return { module, artifact, expectedFingerprint, contracts, executables, catalog: linkedCatalog };
}
export async function loadRouteArtifact(...args: Parameters<typeof verifyRouteArtifact>) {
  const verified = await verifyRouteArtifact(...args);
  const admission = await createRouteAdmission({ ...verified, loadedBindings: verified.module });
  return admission.admitUnknown({ ...verified.module, artifact: verified.artifact });
}
