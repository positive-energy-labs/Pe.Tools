/**
 * The ONE product home resolver. Host, mcps, and runtime import this; nobody keeps a copy, and the
 * Revit side (`ProductPathing.ResolveProductHome`) reads the same override name.
 *
 * An isolated `PE_TOOLS_PRODUCT_HOME` wins over the content-only `PE_TOOLS_SHARED_ROOT` mount.
 * With neither configured, refuse rather than silently select a different content home.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve, isAbsolute } from "node:path";
import { productPathNames } from "./contracts/product.ts";

/** Set only by the test global setup (`ts/tests/isolated-home`): the per-run temp root. */
export const testHomeRootVariable = "PE_TEST_HOME_ROOT";

/**
 * Fixture isolation tripwire. Under a test run (the marker is set) no product path may resolve
 * outside the OS temp directory: a test that reached the owner's real home fails where it resolved,
 * not after it wrote there. Outside tests this is the identity function.
 */
export function insideTestRoot(path: string): string {
  if (!process.env[testHomeRootVariable]) return path;
  const inside = [tmpdir(), realpathSync(tmpdir())].some((root) => {
    const away = relative(resolve(root), resolve(path));
    return !away.startsWith("..") && !isAbsolute(away);
  });
  if (!inside)
    throw new Error(
      `Test isolation: '${path}' is outside the temp directory. Set ${productPathNames.productHomeVariable} (and LOCALAPPDATA) to a temp dir.`,
    );
  return path;
}

/** The content root; environment configuration is read live. */
export function productHomePath(): string {
  const root =
    process.env[productPathNames.productHomeVariable]?.trim() ||
    process.env[productPathNames.sharedRootVariable]?.trim();
  if (!root)
    throw new Error(`Set ${productPathNames.sharedRootVariable} to the shared content mount.`);
  return insideTestRoot(resolve(root));
}
