import { writeFileSync } from "node:fs";
import { z } from "zod";
import { nativeAdapterSchema } from "../src/native-adapter.ts";

writeFileSync(
  new URL("../src/native-adapter.schema.json", import.meta.url),
  JSON.stringify(z.toJSONSchema(nativeAdapterSchema, { reused: "ref" }), null, 2) + "\n",
);
