import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, commitDoc, guardCommand, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";

const schema = z
  .object({
    values: z.record(z.string(), z.string()).default({}),
    staged: z.array(z.string()).default([]),
  })
  .prefault({});
const spec = {
  route: "test",
  title: "Test",
  description: "Test route document.",
  schema,
  agentWriteMask: [["values"]],
  commands: {
    save: { description: "Save.", actor: "human", input: z.object({ value: z.string() }) },
  },
} satisfies RouteStateSpec<typeof schema>;
const envelope = (): RouteEnvelope<z.infer<typeof schema>> => ({
  version: 1,
  revision: 0,
  doc: schema.parse({}),
});

describe("route document machine", () => {
  it("applies, guards, and commits without a store", () => {
    expect(
      applyPatches(spec, envelope(), "agent", [{ path: ["values", "a"], value: "landed" }]),
    ).toMatchObject({ ok: true, envelope: { revision: 1, doc: { values: { a: "landed" } } } });
    expect(
      applyPatches(spec, envelope(), "agent", [{ path: ["staged"], value: ["blocked"] }]),
    ).toMatchObject({ ok: false, error: expect.stringContaining("not agent-writable") });
    expect(
      applyPatches(spec, envelope(), "human", [{ path: ["staged", 0], value: "old fixture" }]),
    ).toMatchObject({ ok: false, hint: "patch paths must address plain document keys." });
    expect(guardCommand(spec, envelope(), "agent", "save", { value: "x" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("human-only"),
    });
    expect(commitDoc(spec, envelope(), { values: { a: 1 } })).toMatchObject({
      ok: false,
      error: "the patched document is invalid",
    });
  });

  it("imports only zod and route-state", async () => {
    const source = await readFile(new URL("./route-doc.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1])).toEqual([
      "zod",
      "./route-state.ts",
    ]);
  });
});
