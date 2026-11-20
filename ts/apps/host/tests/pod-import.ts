import { Effect } from "effect";
import { z } from "zod";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import { installArchive, type TransferOptions } from "../src/pod-transfer.ts";
import { detachedBridge, pictureCaptures } from "./effect-test.ts";
import { human } from "./callers.ts";
import { dirname, join } from "node:path";

/** Exercise production admission even when an installation test needs an isolated destination. */
export async function prepareImport(request: { archivePath: string; folder?: string }) {
  const executor = gatewayExecutor(
    "pod.import",
    detachedBridge(),
    () => Effect.die("unexpected local call"),
    pictureCaptures(join(dirname(request.archivePath), "captures")),
  );
  const bound = await executor.bind({
    admission: { id: "import-test", key: "pod.import", target: { kind: "host" }, input: request },
    caller: human,
    basis: null,
    consumed: [],
    get work(): never {
      throw Error("import must not read Work");
    },
    selectWork: async () => {
      throw Error("import must not select Work");
    },
    read: { receipts: () => [] },
    clock: { now: () => "2026-11-14T00:00:00.000Z" },
    ids: { mint: () => "import-test" },
  });
  const prepared = z
    .object({
      archive: z.object({
        bytesBase64: z.string(),
        locator: z.string(),
        folder: z.string().optional(),
      }),
    })
    .parse(await bound.prepare!());
  return { bound, archive: prepared.archive };
}

export async function importPod(
  request: { archivePath: string; folder?: string },
  options: TransferOptions = {},
) {
  const { archive } = await prepareImport(request);
  return installArchive(
    Buffer.from(archive.bytesBase64, "base64"),
    archive.locator,
    archive.folder,
    options,
  );
}
