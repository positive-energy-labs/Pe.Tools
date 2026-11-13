import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { userRoot } from "@pe/host-contracts/product-paths";

/** The user's Pods folder: where imports and every Pod write land. */
export function productPodsRootPath(): string {
  return join(userRoot(), productPathNames.podsDirectoryName);
}
