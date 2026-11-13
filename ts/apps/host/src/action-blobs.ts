import { blobRefSchema, type BlobRef } from "@pe/agent-contracts";
import { rest, rested } from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";
import { refused } from "./command-executor.ts";

// PictureCaptures owns PNG observations. This store owns arbitrary command input/output bytes.
export async function put(bytes: Uint8Array, fileName: string): Promise<BlobRef> {
  const { sha256: digest } = rest(hostState(), bytes);
  return { digest, size: bytes.byteLength, fileName };
}
export async function get(ref: BlobRef): Promise<Buffer> {
  blobRefSchema.parse(ref);
  const bytes = rested(hostState(), ref.digest);
  if (!bytes)
    throw refused(`Stored bytes are missing or corrupt for ${ref.fileName} (${ref.digest})`, "blob.missing");
  if (bytes.length !== ref.size)
    throw refused(`Stored bytes failed integrity for ${ref.fileName} (${ref.digest})`, "blob.corrupt");
  return bytes;
}
