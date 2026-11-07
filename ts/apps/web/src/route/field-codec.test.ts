import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { decodeField } from "./field-codec";

test("URL fields accept JSON, validated text, or their default without throwing", () => {
  const stage = { schema: z.enum(["audit", "apply"]), initial: "apply" };
  expect(decodeField(stage, "audit")).toBe("audit");
  expect(decodeField(stage, '"audit"')).toBe("audit");
  expect(decodeField(stage, "unknown")).toBe("apply");
  const search = { schema: z.object({ keywords: z.string() }), initial: { keywords: "" } };
  expect(decodeField(search, "")).toEqual(search.initial);
  expect(decodeField(search, '{"keywords":"Chadds"}')).toEqual({ keywords: "Chadds" });
  expect(decodeField(search, '{"keywords":')).toEqual(search.initial);
});
