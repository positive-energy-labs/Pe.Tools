import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256Hex, type At, type StoredFile } from "@pe/host-contracts/kinds";

export function artifactRelative(root: string, path: string) {
  const from = relative(resolve(root), resolve(path));
  if (from === ".." || from.startsWith("..\\") || from.startsWith("../") || isAbsolute(from))
    throw Error(`Artifact refuses a path outside its root: ${path}`);
  return from.replaceAll("\\", "/");
}

class ContentAddressCorruption extends Error {
  override readonly name = "ContentAddressCorruption";
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `ContentAddressCorruption: artifact hash collision at ${path}; hashes to ${actual}, expected ${expected}`,
    );
  }
}

/** The one artifact writer, for Pages, exports and Pods: no directory it creates or writes into
 * resolves outside `root`. An existing artifact must already hold the same bytes. It never changes the
 * supplied bytes. */
export async function writeArtifact(
  root: string,
  file: StoredFile<unknown, At>,
  source: string | Uint8Array,
): Promise<string> {
  const path = file.path;
  const bytes = Buffer.from(source);
  const parts = artifactRelative(root, dirname(path)).split("/").filter(Boolean);
  await mkdir(root, { recursive: true });
  let directory = (root = await realpath(root));
  for (const part of parts) {
    directory = join(directory, part);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    artifactRelative(root, await realpath(directory));
  }
  const expected = sha256Hex(bytes);
  const existing = async () => {
    let stored: Buffer;
    try {
      const resolved = await realpath(path);
      artifactRelative(root, resolved);
      stored = await readFile(resolved);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
    const actual = sha256Hex(stored);
    if (actual !== expected) throw new ContentAddressCorruption(path, expected, actual);
    return true;
  };
  if (await existing()) return path;
  const temporary = join(directory, `.artifact-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    // A rename can replace a concurrent winner; link atomically publishes only if absent.
    await link(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      if (!(await existing())) throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}
