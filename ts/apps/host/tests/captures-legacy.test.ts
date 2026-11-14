import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test } from "vite-plus/test";
import { PictureCaptures, PictureCaptureStore, capturesRoute } from "../src/captures-route.ts";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("/captures lists every pre-marks receipt without rewriting the log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-captures-old-"));
  const receipts = ["old-first", "old-second"].map((id) => ({
    id,
    sha: sha(Buffer.from(id)),
    at: "2026-11-01T00:00:00.000Z",
    origin: "human",
    document: { title: "Existing model" },
    view: { id: 42, name: "Plan" },
    focus: null,
    registration: null,
    byteSize: 10,
    url: `/captures/${sha(Buffer.from(id))}.png`,
  }));
  const log = receipts.map((receipt) => JSON.stringify(receipt)).join("\n") + "\n";
  const path = join(dir, "receipts.jsonl");
  const web = HttpRouter.toWebHandler(
    capturesRoute(() => Effect.succeed(HttpServerResponse.text("spa"))),
  );
  try {
    await writeFile(path, log);
    const response = await web.handler(
      new Request("http://host/captures"),
      Context.make(PictureCaptureStore, new PictureCaptures(stateFixture(dir), 1024 ** 3, Date.now)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      captures: receipts.toReversed().map((receipt) => ({ ...receipt, marks: [] })),
    });
    expect(await readFile(path, "utf8")).toBe(log);
  } finally {
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
