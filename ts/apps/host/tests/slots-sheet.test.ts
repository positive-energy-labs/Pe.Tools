import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts";
import { evaluate, read, type InputPort } from "../src/reads/evaluator.ts";
import { sheetWrites } from "../src/slots/sheet.ts";

// Slice 7, the host half of the sheet slot: what sheet.plan derives from a route's Work, and the Pod's document Work door.
test("sheetWrites derives one parameter write per staged row, by UniqueId, and none for a local binding", () => {
  const code = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("pipe-1") });
  const writes = sheetWrites(
    { bindings: {
      chosen: { kind: "parameter", parameter: "Diameter", per: "subject", unit: "Millimeters" },
      maxVelocity: { kind: "local", per: "route" },
    } },
    { chosen: { [code]: 25, "pipe-2": 32, "pipe-3": null }, maxVelocity: 1.5 },
  );
  expect(writes.map((w) => [w.uniqueId, w.parameter, w.value, w.unit])).toEqual([
    ["pipe-1", "Diameter", 25, "Millimeters"],
    ["pipe-2", "Diameter", 32, "Millimeters"],
  ]);
});

test("ctx.work with a document ref reads that document's Work for the owner", async () => {
  const taken: [string, unknown][] = [];
  const port: InputPort = {
    evaluation: "e",
    origin: null,
    revision: () => 0,
    take: async (name, args) => {
      taken.push([name, args]);
      if (name === "work-scope") return { binding: "host", route: "any", target: null };
      if (name === "work") return { doc: { chosen: {} }, revision: 3 };
      throw Error(`unexpected ${name}`);
    },
  };
  const probe = read("pod.probe", {
    input: z.object({}),
    output: z.unknown(),
    run: (ctx) => ctx.work("pod.hydronic.sizing", { session: "s", openId: "o" }),
  });
  const value = await evaluate(probe, {}, port);
  expect(value.data).toEqual({ doc: { chosen: {} }, revision: 3 });
  const expected = [
    ["work-scope", { session: "s", openId: "o" }],
    ["work", { owner: "pod.hydronic.sizing", scope: { binding: "host", route: "pod.hydronic.sizing", target: null } }],
  ];
  // The document's key first, then its Work under the owner; final validation takes the same leaves again.
  expect(taken.slice(0, 2)).toEqual(expected);
  for (const take of taken) expect(expected).toContainEqual(take);
});
