// Node-only checkout paths for the web app's vite config and tests. Browser code never imports
// this; it reaches the family fixtures through the `@family-fixtures` alias the config declares.
import { join } from "node:path";
import { checkoutLayout, checkoutRootFrom } from "@pe/host-contracts/service-identity";

const root = checkoutRootFrom(import.meta.dirname);
if (!root) throw new Error(`apps/web is not inside a Pe.Tools checkout (${import.meta.dirname}).`);

export const checkoutRoot = root;

/** Client fixtures live outside the tree; `PE_PRIVATE_FIXTURES` points elsewhere when needed. */
export const privateFixturesDir =
  process.env.PE_PRIVATE_FIXTURES ?? join(root, ".private", "fixtures");

/** The authored family fixtures, owned by the C# test project. */
export const familyFixturesDir = join(
  root,
  checkoutLayout.dotnet,
  "Pe.Revit.Tests",
  "Fixtures",
  "FamilyModel",
);
