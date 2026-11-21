import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The version of a file a product declares as an `externalFile`: the hash of its bytes. */
export const fileVersion = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
