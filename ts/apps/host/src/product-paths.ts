import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { contentHomes, ContentHomeUnavailable } from "./content-roots.ts";

/** The user's Pods folder: where imports and every Pod write land. */
export function productPodsRootPath(): string {
  const user = contentHomes().find((home) => home.tier === "user")?.root;
  if (!user) throw new ContentHomeUnavailable();
  return join(user, productPathNames.podsDirectoryName);
}
