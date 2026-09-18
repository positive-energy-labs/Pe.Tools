import { homedir } from "node:os";
import { join } from "node:path";
import { productIdentity, productPathNames } from "@pe/host-contracts/contracts";

import { userDocumentsPath } from "@pe/host-contracts/product-paths";

export { userDocumentsPath };

export function productUserContentRootPath(): string {
  return join(userDocumentsPath(), productIdentity.productName);
}

export function productPodsRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.podsDirectoryName);
}

export function productPreferencesPath(): string {
  return join(productUserContentRootPath(), productPathNames.preferencesFileName);
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
