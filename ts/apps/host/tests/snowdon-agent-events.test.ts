import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { asCaller, pea } from "./callers.ts";

// W45 review: the ported worksheet must stay editable by Pea through its declared Page events.
test("Pea can edit the Snowdon circuits worksheet through its Page event door", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-snowdon-agent-"));
  try {
    const examples = join(import.meta.dirname, "../../../../examples/pods");
    const agent = asCaller(
      pea(),
      createPagesHandler([], examples, undefined, undefined, stateFixture(root)),
    );
    const state = await agent(new Request("http://host/pages/snowdon-circuits--tour/state"));
    expect(state.status).toBe(200);
    expect(Object.keys((await state.json()).agent).sort()).toEqual(["input", "set"]);
    const post = (event: object) =>
      agent(
        new Request("http://host/pages/snowdon-circuits--tour/events", {
          method: "POST",
          body: JSON.stringify({ v: 1, ...event }),
        }),
      );
    expect((await post({ type: "input", key: "length", value: "200" })).status).toBe(201);
    expect((await post({ type: "reading", reading: {} })).status).toBe(422);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
