import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";

import { productHomePath } from "@pe/host-contracts/product-paths";

export const productUserContentRootPath = productHomePath;

export function productPodsRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.podsDirectoryName);
}

/** Pages (`pages-route.ts`): one folder per page beside Pods, outside git, no registration. */
export function productPagesRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.pagesDirectoryName);
}

/** A path under machine-local product state (`<productRoot>\state`): keys and per-machine data, not Documents. */
const productStatePath = (...segments: string[]) =>
  join(hostOwnership.rootPath, productPathNames.stateDirectoryName, ...segments);

export const productApsCredentialsPath = () => productStatePath("aps-auth", "credentials.json");

export const productApsTokensPath = () => productStatePath("aps-auth", "tokens.json");

/** One directory per harness thread (`harness/threads.ts`): `meta.json` + `events.jsonl`. */
export const productHarnessThreadsPath = () => productStatePath("harness-threads");

/** Route Work documents (`pe-routes.ts`): one JSON file per route and Work key. */
export const productRouteWorkPath = () => join(productUserContentRootPath(), "Work");
export const productRouteSettingsPath = () =>
  join(productUserContentRootPath(), "settings", "routes");

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
