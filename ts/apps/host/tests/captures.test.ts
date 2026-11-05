import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { expect, test } from "vite-plus/test";
import { CaptureStore, capturesRoute } from "../src/captures-route.ts";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("/captures serves the store only: a navigation is the SPA, a caller path never reaches the filesystem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-captures-"));
  const store = new CaptureStore(join(dir, "store"));
  const web = HttpRouter.toWebHandler(
    capturesRoute(() => Effect.succeed(HttpServerResponse.text("spa")), () => store),
  );
  const fetch = (path: string, init?: RequestInit) =>
    web.handler(new Request(`http://host${path}`, init), Context.empty() as never);
  try {
    expect(await (await fetch("/captures", { headers: { accept: "text/html" } })).text()).toBe("spa");
    expect(await (await fetch("/captures")).json()).toEqual({ captures: [] });
    const outside = Buffer.from("secret");
    await writeFile(join(dir, `${sha(outside)}.png`), outside);
    for (const path of [
      `/captures/${sha(outside)}.png`,
      `/captures/..%2F${sha(outside)}.png`,
      `/captures/${sha(outside).toUpperCase()}.png`,
      `/captures/${sha(outside)}`,
      `/captures/${sha(outside)}.png/x`,
    ])
      expect([400, 404]).toContain((await fetch(path)).status);
  } finally {
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
