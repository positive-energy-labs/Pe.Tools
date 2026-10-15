import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Effect } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { z } from "zod";
import type { CloudVersion } from "@pe/agent-contracts";
import { apsAuthToken } from "./aps-auth.ts";

const API = "https://developer.api.autodesk.com";
const versionResource = z.object({
  data: z.object({
    type: z.literal("versions"),
    id: z.string(),
    attributes: z.object({
      extension: z.object({
        data: z.object({
          projectGuid: z.string(),
          modelGuid: z.string(),
        }),
      }),
    }),
    relationships: z.object({
      item: z.object({ data: z.object({ id: z.string() }) }),
      storage: z.object({ data: z.object({ id: z.string() }) }),
    }),
  }),
});

export interface VersionDownload {
  sha256: string;
  bytes: number;
  version: CloudVersion;
  storageId: string;
}

/** No connected Revit open, cache path or latest-version alias participates in acquisition. */
export async function downloadCloudVersion(
  source: string,
  version: CloudVersion,
  to: string,
  dependencies: { token?: () => Promise<string>; fetch?: typeof fetch } = {},
): Promise<VersionDownload> {
  const identity =
    /^cld:\/\/([^/]+)\/\{([0-9a-f-]{36})\}[^/]*\/\{([0-9a-f-]{36})\}[^/]*\.rvt$/i.exec(source);
  if (!identity || version.projectId.toLowerCase() !== `b.${identity[2]!.toLowerCase()}`)
    throw Error("The APS project must match the explicit cloud model identity.");
  const token = await (
    dependencies.token ??
    (async () => {
      const result = await Effect.runPromise(
        apsAuthToken({ scopeProfile: "AutomationUserContext" }, false).pipe(
          Effect.provide(NodeHttpClient.layerUndici),
          Effect.provide(NodeServices.layer),
        ),
      );
      return result.accessToken;
    })
  )();
  const request = dependencies.fetch ?? fetch;
  const json = async (path: string) => {
    const response = await request(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw Error(`APS version acquisition refused (${response.status}).`);
    return response.json() as Promise<unknown>;
  };
  const { data } = versionResource.parse(
    await json(
      `/data/v1/projects/${encodeURIComponent(version.projectId)}/versions/${encodeURIComponent(version.versionId)}`,
    ),
  );
  const facts = data.attributes.extension.data;
  if (
    data.id !== version.versionId ||
    data.relationships.item.data.id !== version.itemId ||
    facts.projectGuid.toLowerCase() !== identity[2]!.toLowerCase() ||
    facts.modelGuid.toLowerCase() !== identity[3]!.toLowerCase()
  )
    throw Error("APS version lineage does not match the requested item and cloud model.");
  const storageId = data.relationships.storage.data.id;
  const storage = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(storageId);
  if (!storage) throw Error("The immutable APS version has no downloadable OSS storage object.");
  const signed = z
    .object({ status: z.literal("complete"), url: z.url() })
    .parse(
      await json(
        `/oss/v2/buckets/${encodeURIComponent(storage[1]!)}/objects/${encodeURIComponent(decodeURIComponent(storage[2]!))}/signeds3download`,
      ),
    );
  const url = new URL(signed.url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("APS returned an invalid signed download URL.");
  // The signed URL carries its own authorization. Never send the APS bearer to storage.
  const response = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!response.ok || !response.body)
    throw Error(`APS source download failed (${response.status}).`);
  await mkdir(dirname(to), { recursive: true });
  const file = await open(to, "wx");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      file.createWriteStream(),
    );
    if (!bytes) throw Error("APS downloaded an empty source.");
    return { version, storageId, sha256: hash.digest("hex"), bytes };
  } catch (error) {
    await file.close();
    await rm(to, { force: true });
    throw error;
  }
}
