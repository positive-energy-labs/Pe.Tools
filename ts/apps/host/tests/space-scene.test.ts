import { expect, test } from "vite-plus/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { productRoot } from "@pe/host-contracts/service-identity";
import { createPeRoutes } from "../src/pe-routes.ts";

test("saved scene bytes remain available with no native registrations, and integrity is checked", async () => {
  const app = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: { observe: () => () => {} },
  });
  const bytes = Buffer.from("PSC1 durable capture");
  const id = createHash("sha256").update(bytes).digest("hex");
  const root = join(productRoot(), "cache", "space-scenes");
  const path = join(root, `${id}.bin`);
  const request = () => app.fetch(new Request(`http://host/pe/space/scenes/${id}/artifact`));
  await mkdir(root, { recursive: true });
  try {
    await writeFile(path, bytes);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    await writeFile(path, "corrupt");
    expect((await request()).status).toBe(409);
  } finally {
    await rm(path, { force: true });
  }
  expect((await request()).status).toBe(404);
  expect(
    (await app.fetch(new Request("http://host/pe/space/scenes/invalid/artifact"))).status,
  ).toBe(400);
});
