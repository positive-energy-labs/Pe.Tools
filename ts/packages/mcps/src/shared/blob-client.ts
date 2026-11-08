import { blobRefSchema, blobUploadSchema, type BlobUpload } from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { contextFetch as fetch } from "@pe/runtime/context";

export async function uploadBlob(input: BlobUpload, base = "") {
  const response = await createPeClient(base, fetch).response("blobs.put", { body: blobUploadSchema.parse(input) });
  if (!response.ok) throw Error(`Upload failed (${response.status}): ${await response.text()}`);
  return blobRefSchema.parse(await response.json());
}
