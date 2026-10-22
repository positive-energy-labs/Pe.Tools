import { expect, test } from "vite-plus/test";
import { nativeAdapterSchema } from "./native-adapter.ts";
import { readFileSync } from "node:fs";
import { z } from "zod";

test("tray embeds the JSON schema generated from the same TypeScript authority", () => {
  const embedded = JSON.parse(
    readFileSync(new URL("./native-adapter.schema.json", import.meta.url), "utf8"),
  );
  expect(embedded).toEqual(z.toJSONSchema(nativeAdapterSchema, { reused: "ref" }));
});
