import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { peaWorkValue } from "../src/pea/capability-tools.ts";
import { renderDuctsSkill } from "../src/pea/ducts-skill.ts";

/** Driver C13: the /fans read carried its transport JSON Schema beside a tiny doc. */
const fansRead = () => ({
  route: "fans",
  title: "Fans",
  description: "Fans",
  doc: fansDocumentSchema.parse({}),
  revision: 3,
  schemaVersion: 1,
  schema: z.toJSONSchema(fansDocumentSchema, { unrepresentable: "any" }),
});

test("Pea's Work read is the doc, revision and provenance, not the transport schema", () => {
  const raw = fansRead();
  expect(JSON.stringify(raw.schema).length).toBeGreaterThan(20_000);
  const value = peaWorkValue(raw);
  expect(value).not.toHaveProperty("schema");
  expect(value).toMatchObject({ route: "fans", revision: 3, schemaVersion: 1, doc: raw.doc });
  expect(JSON.stringify(value).length).toBeLessThan(2_000);
  // The schema stays reachable through the same read, and errors pass through untouched.
  expect(peaWorkValue(raw, true)).toHaveProperty("schema");
  const refusal = { isError: true, content: "no", schema: 1 };
  expect(peaWorkValue(refusal)).toBe(refusal);
});

test("Driver C14: Pea stages the fan walk and passes the primary Ducts handle before planning losses", () => {
  const text = renderDuctsSkill();
  expect(text).toContain("writeIntent.walk");
  expect(text).toContain("work: { key, revision }, the route:ducts Work handle");
  expect(text).toContain("Fan write cells are derived");
  expect(text).not.toContain("key, expectedRevision");
  expect(text).toContain("The open Page never supplies the walk");
});
