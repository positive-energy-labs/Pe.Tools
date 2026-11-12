import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { userRoot } from "@pe/host-contracts/product-paths";
import { hostOwnership } from "./host-ownership.ts";

export const productUserContentRootPath = userRoot;

/** The user's Pods folder: where imports and every Pod write land. */
export function productPodsRootPath(): string {
  return join(userRoot(), productPathNames.podsDirectoryName);
}

/** The user's Pages folder (`pages-route.ts`): one folder per page beside Pods, outside git, no registration. */
export function productPagesRootPath(): string {
  return join(userRoot(), productPathNames.pagesDirectoryName);
}

/**
 * A path under machine-local product state (`<productRoot>\state`): keys and per-machine data, not
 * Documents. The installer never clears `state\` (it refuses any path with that segment), so what
 * sits here outlives an upgrade; a new sibling of `bin\` would have no such promise.
 */
const productStatePath = (...segments: string[]) =>
  join(hostOwnership.rootPath, productPathNames.stateDirectoryName, ...segments);

export const productApsCredentialsPath = () => productStatePath("aps-auth", "credentials.json");

export const productApsTokensPath = () => productStatePath("aps-auth", "tokens.json");

/** One directory per harness thread (`harness/threads.ts`): `meta.json` + `events.jsonl`. */
export const productHarnessThreadsPath = () => productStatePath("harness-threads");

// A home holds only authored files (ADR 0037 rule 6). Work, Page state and the agent's working
// directory are machine state; `state\Runs` and `state\Blobs` join them from their own writers.
/** Route Work documents (`pe-routes.ts`): one JSON file per route and Work key. */
export const productRouteWorkPath = () => productStatePath("Work");
/** Page state (`pages-route.ts`): one folder per Page slug, holding its event log, snapshot and binding. */
export const productPageStatePath = () => productStatePath("Pages");
/**
 * The agent's working directory, fixed once: the harness child's cwd, the Pea world's root, and the
 * home of the harness projections (`.agents/skills`, `.claude/skills`, `.codex/config.toml`). T3
 * keys its project on this path, so moving it strands every thread.
 */
export const productAgentPath = () => productStatePath("Agent");
/** Reserved for the T3 home, whose files are foreign to Pe. Named only: nothing reads or writes it yet. */
export const productT3Path = () => productStatePath("T3");

/** Immutable headless Ducts calculations, including their complete effective inputs. */
export const productDuctsAnalysesPath = () => productStatePath("ducts", "analyses");

/**
 * Pea's work folder: the copies she opens so a user's own file is never her scratch. Machine
 * state: model copies must not upload.
 */
export const productPeaWorkPath = () => productStatePath("pea-work");

/** User-added endpoint providers (`harness/providers.ts`). Holds keys: state, not Documents. */
export const productProvidersPath = () => productStatePath("providers.json");
export const productPluginDecisionsPath = () => productStatePath("plugins.json");
export const productRouteTrustPath = () => productStatePath("route-trust.json");
