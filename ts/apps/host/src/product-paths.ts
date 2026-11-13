import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { userRoot } from "@pe/host-contracts/product-paths";
import { hostState } from "./host-ownership.ts";

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
 * This host's machine state (`<productRoot>\state`): keys and per-machine data, not Documents.
 * The installer never clears `state\` (it refuses any path with that segment), so what sits here
 * outlives an upgrade; a new sibling of `bin\` would have no such promise.
 * `stateTree` is the one table that mints a machine-state path (routes CONTRACTS K-A2): every
 * name below reads a row of `hostState()`, and a new location is a row there, not a `join` here.
 * They answer plain strings for the callers the store sweeps have not reached yet.
 */

export const productApsCredentialsPath = (): string => hostState().apsCredentials;

export const productApsTokensPath = (): string => hostState().apsTokens;

/** One directory per harness thread (`harness/threads.ts`): `meta.json` + `events.jsonl`. */
export const productHarnessThreadsPath = (): string => hostState().harnessThreads;

// A home holds only authored files (ADR 0037 rule 6). Work, Page state and the agent's working
// directory are machine state; `state\Runs` and `state\Blobs` join them from their own writers.
/** Route Work documents (`pe-routes.ts`): one JSON file per route and Work key. */
export const productRouteWorkPath = (): string => hostState().work;
/** Page state (`pages-route.ts`): one folder per Page slug, holding its event log, snapshot and binding. */
export const productPageStatePath = (): string => hostState().pages;
/**
 * The agent's working directory, fixed once: the harness child's cwd, the Pea world's root, and the
 * home of the harness projections (`.agents/skills`, `.claude/skills`, `.codex/config.toml`). T3
 * keys its project on this path, so moving it strands every thread.
 */
export const productAgentPath = (): string => hostState().agent;
/** Reserved for the T3 home, whose files are foreign to Pe. Named only: nothing reads or writes it yet. */
export const productT3Path = (): string => hostState().t3;

/** Immutable headless Ducts calculations, including their complete effective inputs. */
export const productDuctsAnalysesPath = (): string => hostState().ductsAnalyses;

/**
 * Pea's work folder: the copies she opens so a user's own file is never her scratch. Machine
 * state: model copies must not upload.
 */
export const productPeaWorkPath = (): string => hostState().peaWork;

/** User-added endpoint providers (`harness/providers.ts`). Holds keys: state, not Documents. */
export const productProvidersPath = (): string => hostState().providers;
export const productPluginDecisionsPath = (): string => hostState().pluginDecisions;
export const productRouteTrustPath = (): string => hostState().routeTrust;
