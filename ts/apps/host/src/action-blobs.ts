import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blobRefSchema, type BlobRef } from "@pe/agent-contracts";
import { sha256Hex, writeArtifact } from "./page-artifacts.ts";
import { hostOwnership } from "./host-ownership.ts";
import { refused } from "./command-executor.ts";

// PictureCaptures owns PNG observations. This store owns arbitrary command input/output bytes.
const root = () => join(hostOwnership.rootPath, "state", "host", hostOwnership.serviceName, "blobs");
export async function put(bytes: Uint8Array, fileName: string): Promise<BlobRef> {
  const digest = sha256Hex(bytes);
  await writeArtifact(root(), join(root(), digest), Buffer.from(bytes));
  return { digest, size: bytes.byteLength, fileName };
}
export async function get(ref: BlobRef): Promise<Buffer> {
  blobRefSchema.parse(ref);
  let bytes: Buffer;
  try { bytes = await readFile(join(root(), ref.digest)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw refused(`Stored bytes are missing for ${ref.fileName} (${ref.digest})`, "blob.missing");
    throw error;
  }
  if (bytes.length !== ref.size || sha256Hex(bytes) !== ref.digest)
    throw refused(`Stored bytes failed integrity for ${ref.fileName} (${ref.digest})`, "blob.corrupt");
  return bytes;
}
export async function retainUpload(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const source = input.source;
  if (!source || typeof source !== "object" || !("base64" in source)) return input;
  const upload = source as {base64: string; fileName: string};
  return {...input, source: await put(Buffer.from(upload.base64, "base64"), upload.fileName)};
}
