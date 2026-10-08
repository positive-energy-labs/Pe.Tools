import { homedir } from "node:os";
import { join } from "node:path";
import { productIdentity, productPathNames } from "@pe/host-contracts/contracts";

import { userDocumentsPath } from "@pe/host-contracts/product-paths";

export function productUserContentRootPath(): string {
  return join(userDocumentsPath(), productIdentity.productName);
}

export function productPodsRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.podsDirectoryName);
}

/** Pages (`pages-route.ts`): one folder per page beside Pods, outside git, no registration. */
export function productPagesRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.pagesDirectoryName);
}

export function productApsCredentialsPath(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    "aps-auth",
    "credentials.json",
  );
}

/** One directory per harness thread (`harness/threads.ts`): `meta.json` + `events.jsonl`. */
export function productHarnessThreadsPath(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    "harness-threads",
  );
}

/** Route Work documents (`pe-routes.ts`): one JSON file per route and Work key. */
export function productRouteWorkPath(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    "route-work",
  );
}

/** A file under product state (LOCALAPPDATA): settings that hold a key or belong to this machine. */
function productStateFile(name: string): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    name,
  );
}

/** User-added endpoint providers (`harness/providers.ts`). Holds keys: state, not Documents. */
export const productProvidersPath = () => productStateFile("providers.json");

/** The access setting, `{ guarded }` (`harness/providers.ts`). */
export const productAccessPath = () => productStateFile("access.json");
