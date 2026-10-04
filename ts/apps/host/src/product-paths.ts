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

/** The one OpenAI-compatible endpoint Pea uses (`inference-endpoint.ts`). Holds a key: state, not Documents. */
export function productInferenceEndpointPath(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    "inference-endpoint.json",
  );
}
