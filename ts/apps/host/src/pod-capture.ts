import { resolve } from "node:path";
import type { AdmittedPackage, PackageListing, PodsRoots } from "./packages.ts";

let productRoots: PodsRoots | undefined;
export const rememberCaptureRoots = (roots: PodsRoots) => {
  productRoots = roots;
};
const rootsKey = (roots: PodsRoots) => JSON.stringify([roots].flat().map((root) => resolve(root)));
// Discovery owns cross-home identity; capture reads fresh bytes only from its selected folder.
const censuses = new Map<string, Pick<AdmittedPackage, "id" | "folder" | "directory">[]>();
export function rememberPackageCensus(roots: PodsRoots, listing: PackageListing) {
  censuses.set(
    rootsKey(roots),
    listing.packages.map(({ id, folder, directory }) => ({ id, folder, directory })),
  );
}

export async function captureIndexedPackage(
  id: string,
  roots: PodsRoots | undefined,
  read: (directory: string, folder: string, signal: AbortSignal) => Promise<AdmittedPackage>,
): Promise<AdmittedPackage> {
  // Do not resolve homes here: synchronous Drive probing runs outside any async deadline.
  const selectedRoots = roots ?? productRoots;
  const census = selectedRoots && censuses.get(rootsKey(selectedRoots));
  if (!census)
    throw Error(
      `Pod '${id}' cannot be captured before Pod discovery finishes. Refresh the Pod list and try again.`,
    );
  const found = census.filter((pod) => pod.id === id);
  if (found.length > 1)
    throw Error(
      `Pod id '${id}' is claimed by ${found.map((pod) => pod.directory).join(" and ")}: none is used until the id is unique.`,
    );
  const selected = found[0];
  if (!selected)
    throw Error(
      `No discovered Pod has id '${id}'. Refresh the Pod list after adding or moving a Pod.`,
    );
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pod = await Promise.race([
      read(selected.directory, selected.folder, stop.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stop.abort();
          reject(
            Error(
              `Pod '${id}' capture exceeded 5000 ms reading '${selected.directory}'. Try again when this folder is available.`,
            ),
          );
        }, 5_000);
      }),
    ]);
    if (pod.id !== id)
      throw Error(
        `Pod identity changed in '${selected.directory}'. Refresh the Pod list and try again.`,
      );
    return pod;
  } finally {
    clearTimeout(timer);
  }
}
